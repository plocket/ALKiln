let names = {};

names.description = `a_safe_scenario_description`;

names.chinese_input = `是汉字`;
names.chinese_output = `是汉字`;

names.no_underscore_input = `ends_in_no_underscore`;
names.no_underscore_output = `ends_in_no_underscore`;

names.one_underscore_input = `ends_in_one_underscore_`;
names.one_underscore_output = `ends_in_one_underscore_`;

names.two_underscores_input = `ends_in_two_underscores__`;
names.two_underscores_output = `ends_in_two_underscores__`;

names.empty_string_input = ``;
names.empty_string_output = ``;

names.undefined_input;
names.undefined_output = ``;

names.colon_input = `invalid:colon`;
names.colon_output = `invalid_colon`;

names.slash_input = `invalid/slash`;
names.slash_output = `invalid_slash`;

names.two_consecutive_invalid_input = `two_consecutive//invalid`;
names.two_consecutive_invalid_output = `two_consecutive__invalid`;

names.numerical_input = `scenario_w1th_number00`;
names.numerical_output = `scenario_w1th_number00`;

names.long_id_input = `over_20_chars_123456789`;
names.long_id_output = `over_20_chars_123456`;

module.exports = names;
