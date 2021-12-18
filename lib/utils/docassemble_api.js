const axios = require('axios');
const qs = require('qs');
const session = require('../utils/session');

// Requests to make to the developer's docassemble server
// Should functions in here already know what the project name is,
// or should developers have to hand it in? Same with github url.

/* Notes:
*   - We are not using `.create()` because we want to get
*   the environment variables fresh every time. */

// Where should we throw errors?
// Where should we log what?
// What's arguments? (nothing other than timeout)
// Do we need to respond if the dev api key expires in the middle of everything?

let log_error = function ( error, docs_url ) {
  if ( error.response && error.response.status ) {
    console.log( `Error ${ error.response.status }: ${ error.response.data } See ${ docs_url } for more details.` );
  } else {
    console.log( error );
  }
};  // Ends log_error()


// node -e 'require("./lib/utils/docassemble_api.js").is_api_key_working()'
let is_valid_api_key = function ( timeout=2000 ) {
  /* Make sure the api key is working */
  // 'Access denied'
};  // Ends is_valid_api_key()


// node -e 'require("./lib/utils/docassemble_api.js").is_server_responding()'
let is_server_responding = async function ( timeout=5000 ) {
  /* Make an arbitrary request to the server to see if it's responding. */
  // Response is undefined when server isn't ready
  try {
    let id = await get_dev_id( timeout );
    if ( typeof id === 'object' ) { throw id; }
  } catch ( error ) {
    // Only want to worry about a timeout error
    console.log( `Tried to ping the server, but ran into an error.` );
    return false;
  }

  if ( session.get_debug() ) { console.log( `Server responded!` ); }
  return true;
};  // Ends is_server_responding()


// node -e 'require("./lib/utils/docassemble_api.js").get_dev_id()'
let get_dev_id = async function ( timeout=2000 ) {
  /* Get docassemble developer id */
  let options = {
    method: 'GET',
    url: `${ session.get_da_server_url() }/api/user`,
    params: { key: session.get_dev_api_key(), },
    timeout: timeout,
  };

  try {

    let response = await axios.request(options);
    if ( session.get_debug() ) { console.log( `User id: ${ response.data.id }` ); }
    return response.data.id;

  } catch (error) {
    log_error( error, `https://docassemble.org/docs/api.html#user` );
    return error;
  }
};  // Ends get_dev_id()


// node -e 'require("./lib/utils/docassemble_api.js").create_project( "create1" )'
let create_project = async function ( project_name, timeout=2000 ) {
  /* Create a new project on the user's da server. */

  if ( !project_name ) { throw `To create a project on the docassemble server, we need a name for the project. Your project name was "${ project_name }"`; }

  let options = {
    method: 'POST',
    url: `${ session.get_da_server_url() }/api/playground/project`,
    data: qs.stringify({
      key: session.get_dev_api_key(),
      project: project_name,
      // project: session.get_project_name(),
    }),
    timeout: timeout,
  };

  try {

    let response = await axios.request(options);
    return response.data;

  } catch (error) {
    log_error( error, `https://docassemble.org/docs/api.html#playground_post_project` );
    // Can't throw in here if running in the console
    // https://www.valentinog.com/blog/throw-async/#how-to-throw-errors-from-async-functions-in-javascript-catch-me-if-you-can
    // throw( `${ error.response.status }: ${ error.response.data } See https://docassemble.org/docs/api.html#playground_post_project for more details.` );
    return error;
  }
};  // Ends create_project()


// node -e 'require("./lib/utils/docassemble_api.js").pull_branch( "create1" )'
let pull_branch = async function ( project_name, timeout=30000 ) {
  /* Pull github code into an existing Project. */

  if ( !project_name ) { throw `To create a project on the docassemble server, we need a name for the project. Your project name was "${ project_name }"`; }
  let options = {
    method: 'POST',
    url: `${ session.get_da_server_url() }/api/playground_pull`,
    data: qs.stringify({
      key: session.get_dev_api_key(),
      project: project_name,
      // project: session.get_project_name(),
      github_url: session.get_repo_url(),
      branch: session.get_branch(),
    }),
    timeout: timeout,
  };

  try {

    let response = await axios.request( options );
    // If server needed to restart
    if ( response.data && response.data.task_id ) {
      if ( session.get_debug() ) { console.log( `Pull task id: ${ response.data.task_id }` ); }
      let done = await is_package_done_updating( response.data.task_id, timeout );
      if ( session.get_debug() ) { console.log( `Is package done being pulled? ${ done }` ); }
      return response.data.task_id;
    }
    
    return response;
  } catch (error) {
    log_error( error, `https://docassemble.org/docs/api.html#playground_pull` );
    return error;
  }
};  // Ends pull_branch()


// node -e 'require("./lib/utils/docassemble_api.js").is_package_done_updating()'
let is_package_done_updating = async function ( task_id, timeout=2000 ) {
  /* Check task status */
  let options = {
    method: 'GET',
    url: `${ session.get_da_server_url() }/api/restart_status`,
    params: {
      key: session.get_dev_api_key(),
      task_id: task_id,
    },
    timeout: timeout,
  };

  try {
    /* From API docs:
    status: If this is 'working', the package update process is still proceeding.
        If it is 'completed', then the package update process is done, and other
        information will be provided. If it is 'unknown', then the task_id has
        expired. The task_id will expire one hour after being issued, or 30 seconds
        after the first 'completed' is returned, whichever is sooner.
    ok: This is provided when the status is 'completed'. It is set to true or
        false depending on whether pip return an error code.
    log: if status is 'completed' and ok is true, the log will contain information
        from the output of pip.
    error_message: if status is 'completed' and ok is false, the error_message will
        contain a pip log or other error message that may explain why the package
        update process did not succeed.
    */

    let response = await axios.request(options);
    let data = response.data;
    if ( session.get_debug() ) { console.log( `Task status: ${ response.data.status }` ); }
    
    if ( data.status ) {
      if ( data.status === 'completed' ) {
        if ( data.ok ) {
          return true;
        } else {
          console.log( `Server restart status error: ${ data.error_message }` );
          // Throw this?
        }
      } else if ( data.status === 'working' ) {
        return false;
      } else {
        console.log( `Pulling package: task_id "${ task_id }" has expired. If it's been less than 1 hour since the task started, the task is complete. Status:` );
        return true;
      }  // ends status type
    } else {
      console.log( `Pulling package: unexpected response.` );
      console.log( response );
      return null;
    }  // ends if ( data.status )

  } catch (error) {
    log_error( error, `https://docassemble.org/docs/api.html#restart_status` );
    return error;
  }

};  // Ends is_package_done_updating()


// Delete the Project
// node -e 'require("./lib/utils/docassemble_api.js").delete_project( "create1" )'
let delete_project = async function ( project_name, timeout=2000 ) {
  /* Delete a project on the user's da server. */

  if ( !project_name ) { throw `To delete a project on the docassemble server, we need a name for the project. Your project name was "${ project_name }"`; }

  let options = {
    method: 'DELETE',
    url: `${ session.get_da_server_url() }/api/playground/project`,
    params: {
      key: session.get_dev_api_key(),
      project: project_name,
      // project: session.get_project_name(),
    },
    timeout: timeout,
  };

  try {

    let response = await axios.request(options);
    return response.data;

  } catch (error) {
    log_error( error, `https://docassemble.org/docs/api.html#playground_delete_project` );
    return error;
  }

};  // Ends delete_project()


module.exports = {
  is_server_responding,
  get_dev_id,
  create_project,
  pull_branch,
  is_package_done_updating,
  delete_project,
};