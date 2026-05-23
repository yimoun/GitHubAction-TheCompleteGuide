core = require('@actions/core');
github = require('@actions/github');
exec = require('@actions/exec');


function run () {
  core.notice('Hello from my custom JavaScript action!');    
}


run();