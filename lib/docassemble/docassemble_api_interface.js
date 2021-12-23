const _da = require('./docassemble_api');
const log = require('../utils/log');
const session_vars = require('../utils/session_vars' );
const time = require('../utils/time');

// Temp notes:
// Do we need to respond if the dev api key expires in the middle of
//    everything? [Answer: the docs don't give an expiration date, so that would
//    only happen if they deleted it in the middle. Which we shouldn't handle?]
// General: How/when do we check if server is busy? Just on error? What about
//    all kinds of race conditions? Probably not something we can overcome. Just
//    do it before trying to load a page.

// TODO: How can we test busy server stuff properly? Especially down
// to specific functions, like `.pull()` which run in a very small
// window.

/** Notes:
* - Checking for a busy server is vulnerable to race conditions, but
*    there's nothing we can do about that.
*/

let da_i = {};
module.exports = da_i;


let is_timeout_error = function( error ) {
  /** Return whether the error is an axios timeout error.
  * See:
  *    Check on https://github.com/axios/axios/issues/1543#issuecomment-558166483 (2019)
  *    and https://github.com/axios/axios/issues/1174#issuecomment-349014752 (2017)
  */
  if ( error.message && error.message.includes( `timeout` ) ) {
    return true;
  }
  return false;
};


// node -e 'require("./lib/github_integration/docassemble_api_interface.js").throw_an_error_if_server_is_not_responding()'
da_i.throw_an_error_if_server_is_not_responding = async function ( options ) {
  /** Make a request to the server to see if it's responding.
  *    It doesn't matter what the request is, as long as it doesn't
  *    cause a server restart.
  *    This is currently meant for puppeteer tests, not for here.
  *
  *    If we do add a loop to poll the server, we can add it in here:
  * let { time_per_loop, max_loops } = options || { time_per_loop: 5 * 1000, max_loops: 15 };
  */

  // Defaults
  let { timeout } = options || { timeout: 5 * 1000 };
  log.info({ pre: `Waiting for the docassemble server to respond. Will wait for ${ timeout/1000 } seconds at most.` });
  
  try {
    let start_time = Date.now()
    // Axios + server will poll until server is ready or timeout is over
    let response = await _da.get_dev_id( timeout );
    let end_time = Date.now()
    if ( response && response.data && response.data.id ) {
      log.info({ pre: `The docassemble server responded after ${ (end_time - start_time)/1000 } seconds.` });
      return false;
    }

  } catch ( error ) {
    // Timeout means the server is busy.
    if ( is_timeout_error( error ) ) {
      // Anything that's waiting for the server to not be busy does not want
      // to move forward without a free server.
      log.info({ pre: `The docassemble server was still busy after ${ timeout/1000 } seconds.` });
    } else {
      // Not sure what to do for other errors. It could be a server
      // error, like an 'Access Denied' error, which should be handled.
      log.warn({ pre: `Tried to check if the docassemble server was busy, but ran into an unexpected `
        + `error. The error didn't indicate a busy server, though.`
      });
    }

    throw error;
  }
};  // Ends da_i.throw_an_error_if_server_is_not_responding()


// node -e 'require("./lib/github_integration/docassemble_api_interface.js").get_dev_id()'
da_i.get_dev_id = async function ( dev_id_options ) {
  /** For consistency, wrap _da.get_dev_id().
  *    See https://docassemble.org/docs/api.html#user.
  *    Should we throw the 'Access Denied' error in here instead? */

  // Default timeouts
  let { timeout } = dev_id_options ||  { timeout: 75 * 1000 };
  return await _da.get_dev_id( timeout );
};  // Ends da_i.get_dev_id();


// node -e 'require("./lib/github_integration/docassemble_api_interface.js").try_api_key()'
da_i.try_api_key = async function ( api_key_options ) {
  /** Make sure the api key is the right one for this server.
  *   See https://docassemble.org/docs/api.html#user. */

  log.info({ pre: `Checking that the API key of the docassemble server's testing account is valid.` });

  // Default timeouts
  api_key_options = api_key_options ||  { timeout: 75 * 1000 };

  try {

    // There's only one possible success result
    // As long as this succeeds, we're good
    await da_i.get_dev_id( api_key_options );
    log.info({ pre: `Your testing account's API key is perfectly valid on this server.` });
    return true;

  } catch ( error ) {
    // There's only one possible sever response error
    if ( error.response && error.response.status === 403 ) {
      // Throw in here, or at the caller
      throw( `Error: Request failed with status code 403, "Access `
        + `Denied". This testing account's `
        + `API key does not exist on this server. Are you sure your `
        + `SERVER_URL GitHub secret is set to the server address on `
        + `which this testing account exists? Are you sure your `
        + `DOCASSEMBLE_DEVELOPER_API_KEY GitHub secret is correct? `
        + `To update your GitHub secrets, either change your repository's `
        + `secrets at ${ session_vars.get_repo_url() }/settings/secrets `
        + `or ask your GitHub organization admin to update the `
        + `organization secrets.`
      );
    } else {
      // Any other error should be thrown
      throw error;
    }  // ends throw different errors
  }  // ends try to get dev_id
};  // Ends da_i.try_api_key()


// node -e 'require("./lib/github_integration/docassemble_api_interface.js").loop_to_create_project()'
da_i.loop_to_create_project = async function( create_project_options ) {
  /** Create a docassemble Project on the docassemble server's account.
  *    Loop through potential project names until we find one that
  *    isn't already taken and then use that name to create the Project. */
  log.info({ pre: `Trying to create a docassemble project.` });

  let default_opts = { timeout: 3 * 1000, max_tries: 15, wait_seconds: 5 };
  let { timeout, max_tries, wait_seconds } = create_project_options || default_opts;

  let project_name = null;
  let name_incrementor = 0;

  // Try to create a project. If the project name is already taken, increment and loop again.
  while ( name_incrementor <= max_tries ) {
    name_incrementor++;
    try {

      // Try next name that could be unique
      project_name = session_vars.get_project_base_name() + name_incrementor;
      log.info({ pre: `Trying to create a Project with the name ${ project_name }` });
      let response = await _da.create_project( project_name, timeout );
      log.info({ pre: `The docassemble server was ready. Created a Project named ${ project_name }` });
      // If succeeded in creating project, return the name that worked
      return project_name;

    } catch ( error ) {
      if ( error.response && error.response.data ) {
        if ( error.response.data.includes( `Invalid project` ) ) {
          // A non-unique project name should just cause another loop
          continue;

        } else {
          // Other response errors should be thrown with link to docs
          throw `${ error.response.status }: ${ error.response.data } See https://docassemble.org/docs/api.html#playground_post_project for more details.`;
        }

      } else {

        // If it's a timeout error, server is busy. Try again after waiting.
        if ( is_timeout_error( error ) && name_incrementor < max_tries ) {
          log.info({ pre: `The docassemble server was busy when trying to create project. `
            + `Attempt ${ name_incrementor } of ${ max_tries }. Will try again `
            + `after ${ wait_seconds } seconds.` });
          await time.waitForTimeout( wait_seconds * 1000 );
          continue;

        // A non-timeout, non-server error should just be thrown
        } else {
          log.warn({ pre: `Ran into unexpected error when trying to create project.` });
          throw error;

        }  // ends type of non-response error
      }  // ends type of reponse error
    }  // ends try
  }  // ends while

  // Failed because there were too many project names already taken
  if ( result && result.includes( `Invalid project` ) && name_incrementor > max_tries) {
    let too_many_project_names_msg = `ALKiln setup: There were already ${ max_tries } `
      + `projects with the base name ${ session_vars.get_project_base_name() }. `
      + `File an issue at https://github.com/SuffolkLITLab/ALKiln/issues.`;
    throw too_many_project_names_msg;
  }
};  // Ends da_i.loop_to_create_project()


// node -e 'require("./lib/github_integration/docassemble_api_interface.js").pull()'
da_i.pull = async function ( pull_options, server_wait_options ) {
  /** Pull github code into an existing Project. */

  log.info({ pre: `Trying to pull code from the "${ session_vars.get_branch_name() }" branch.` });

  // Default timeouts
  let { timeout } = pull_options ||  { timeout: 75 * 1000 };

  try {

    let response = await _da.pull( timeout );

    // If server didn't need to restart
    if ( response && response.status === 204 ) {
      log.debug({ pre: `Status 204 on pull. Did not need the docassemble server to restart.` });
      return null;
    }

    // If server needed to restart because of the pulled code
    if ( response && response.status === 200 ) {
      log.debug({ pre: `Pull task id: ${ response.data.task_id }` });
      return response.data.task_id;
    }

  } catch (error) {
    // Pulling should not error
    log.info({ pre: `Pulling to the docassemble Project ran into an unexpected error. See https://docassemble.org/docs/api.html#playground_pull` });
    throw error;
  }
};  // Ends da_i.pull()


// node -e 'require("./lib/github_integration/docassemble_api_interface.js").has_task_finished()'
da_i.has_task_finished = async function ( task_id, options ) {
  /** Check task status if it exists. If not, return true as task did
  *    not require a server restart. See da_i.pull().
  *    See https://docassemble.org/docs/api.html#restart_status. */

  // Defaults
  let { timeout } = options ||  { timeout: 3 * 1000 };

  try {

    // If server did need to restart, check if it's done.
    let response = await _da.has_task_finished( task_id, timeout );
    log.debug({ pre: `Task status: ${ response.status }. Docassemble server status: ${ response.data.status }. Task id: ${ task_id }` });
    
    if ( response.data.status === 'completed' ) {
      log.info({ pre: `The docassmble server restarted successfully.` });
      return true;
    
    } else if ( response.data.status === 'working' ) {
      log.info({ pre: `The docassmble server is still working on it.` });
      return false;

    } else if ( response.data.status === 'unknown' ) {
      log.info({
        pre: `\`task_id\` "${ task_id }" has expired. If it's been `
          + `less than 1 hour since the task started, the task is `
          + `complete. See https://docassemble.org/docs/api.html#restart_status.`,
        data: response,
      });

      // Server is working, but status unexpected? What to return? Throw?
      // We shouldn't even get here according to the API docs, but it feels
      // weird to have no default behavior
      return null;
    }  // ends status type

  } catch (error) {
    // Timeout means the server is busy.
    if ( is_timeout_error( error ) ) {
      log.info({ pre: `The docassmble server is busy.` });
      return false;
    }

    log.warn({ pre: `Tried to check for the docassmble server restart, but ran into an unexpected error.` });
    throw error;
  }  // ends try to check for server done restarting

};  // Ends da_i.has_task_finished()


da_i.wait_for_server_to_restart = async ( task_id, options ) => {
  /** Wait for the server to finish restarting in case a module needs to load.
  *     This is a polling function because things may be returned
  *     that aren't equivalent to the server being done with a task. */
  log.info({ pre: `Waiting for The docassmble server to restart after pulling code with task_id "${ task_id }".` });

  // Defaults
  let { wait_seconds_per_loop, max_loops } = options || { wait_seconds_per_loop: 5, max_loops: 15 };

  // Flags for stopping the `while` loop
  let num_tries = 0;
  let done_restarting = false;

  // Why loop instead of one long timeout? Because it might not just hang.
  // We might get a return value that's just `waiting`, meaning the
  // task is not done.
  // - [ ] How many tries/time do we give this? Do we allow customization of those values?
  while ( !done_restarting && num_tries <= max_loops ) {
    num_tries++;

    done_restarting = await da_i.has_task_finished( task_id );
    if ( !done_restarting ) {
      if ( num_tries < max_loops ) {
        log.info({ pre: `Attempt ${ num_tries } of ${ max_loops } did not succeed. `
          + `Will try again in ${ wait_seconds_per_loop } seconds.`
        });
        await time.waitForTimeout( wait_seconds_per_loop * 1000 );

      } else {
        // This is our last round, let's wrap it up
        let server_msg = `ALKiln setup: It seems like the docassmble server `
          + `didn't finish restarting after ${ max_loops * wait_seconds_per_loop } `
          + `seconds. Some things you can try: check your server, try `
          + `re-running the test, and check pulling the interview `
          + `manually. See docs at https://suffolklitlab.org/docassemble-AssemblyLine-documentation/docs/automated_integrated_testing/.`;
        throw( server_msg );
      }  // ends if ran out of tries
    }  // ends if done_restarting
  }  // ends while not done restarting

  log.info({ pre: `Package has been pulled and the docassmble server has finished restarting.` });
};  // Ends da_i.wait_for_server_to_restart()


// Delete the Project
// node -e 'require("./lib/github_integration/docassemble_api_interface.js").delete_project( "create1" )'
da_i.delete_project = async function ( delete_options, server_wait_options ) {
  /** Delete a project on the user's da server. */

  // Defaults
  let { timeout } = delete_options ||  { timeout: 75 * 1000 };

  let project_name = session_vars.get_project_name()
  log.info({ pre: `Trying to delete Project ${ project_name }` });

  try {

    let response = await _da.delete_project( timeout );
    log.info({ pre: `Deleted Project "${ project_name }"` });
    return response.data;

  } catch (error) {
    // Should we throw in here?
    log.debug({ pre: `See https://docassemble.org/docs/api.html#playground_delete_project.` });
    log.info({ pre: `Ran into an error when deleting Project ${ project_name }` });
    throw error;
  }

};  // Ends da_i.delete_project()


// node -e 'require("./lib/github_integration/docassemble_api_interface.js").__delete_projects_starting_with( "testingdocassembleALAutomatedTestingTestsmain", 1, 1 )'
da_i.__delete_projects_starting_with = async function ( base_name, starting_num=1, ending_num=50 ) {
  /** Useful for development with accidental infinite loops. */
  let name_incrementor = parseInt( starting_num );
  let final_num = parseInt( ending_num );
  while ( name_incrementor <= final_num ) {
    try {
      let project_name = base_name + name_incrementor;
      log.debug({ pre: `Deleting Project ${ project_name }` });
      await da_i.delete_project( project_name );  
    } catch ( error ) {
      console.log( error )
    }
    name_incrementor++;
  }
};  // Ends da_i.__delete_projects_starting_with()