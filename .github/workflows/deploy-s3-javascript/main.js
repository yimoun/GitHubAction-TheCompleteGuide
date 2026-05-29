const core = require('@actions/core');
// const github = require('@actions/github');
const exec = require('@actions/exec');


function run () {

  // 1) Get some input values
  const bucketName = core.getInput('bucket-name', { required: true });
  const bucketRegion = core.getInput('bucket-region', { required: true });
  const distFolder = core.getInput('dist-folder', { required: true });

  // 2) Upload files
  core.notice('Hello from my custom JavaScript action!');    
  exec.exec(`aws s3 sync ${distFolder} s3://${bucketName} --region ${bucketRegion}`);

  const websiteUrl = `http://${bucketName}.s3-website-${bucketRegion}.amazonaws.com`;
  core.setOutput('website-url', websiteUrl);
}


run();