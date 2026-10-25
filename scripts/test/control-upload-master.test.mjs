import test from 'node:test';
import assert from 'node:assert/strict';
import {publishMaster,uploadArtifact} from '../control/upload-master.mjs';

const revision='a'.repeat(40);
const root=process.cwd();

function fixture(){
  const calls=[];
  return {
    calls,
    run:async(command,args,options)=>{
      calls.push({command,args,options});
      if(args[0]==='fetch')return {stdout:'',stderr:''};
      return {stdout:`${revision}\n`,stderr:''};
    },
    packageBundle:async options=>{calls.push({package:options});return {archive:options.output,revision,sha256:'b'.repeat(64)};},
    verify:async options=>{calls.push({verify:options});},
    upload:async options=>{calls.push({upload:options});return 'http://qupfile.cloudvdn.com/voxcode-test.bundle.gz';},
  };
}

test('publishes the exact fetched master revision and returns the uploaded artifact URL',async()=>{
  const f=fixture();
  const result=await publishMaster({root,output:'/private/tmp/voxcode-test.bundle.gz',qup:'/usr/local/bin/qup-mac.2026',...f});
  assert.deepEqual(result,{archive:'/private/tmp/voxcode-test.bundle.gz',revision,sha256:'b'.repeat(64),sourceRef:'origin/master',url:'http://qupfile.cloudvdn.com/voxcode-test.bundle.gz'});
  assert.deepEqual(f.calls[0].args,['-C',root,'fetch','--no-tags','origin','master']);
  assert.deepEqual(f.calls[1].args,['-C',root,'rev-parse','--verify','FETCH_HEAD^{commit}']);
  assert.deepEqual(f.calls[2],{package:{root,revision,output:'/private/tmp/voxcode-test.bundle.gz'}});
  assert.deepEqual(f.calls[3],{verify:{archive:'/private/tmp/voxcode-test.bundle.gz',digest:'b'.repeat(64)}});
  assert.deepEqual(f.calls[4],{upload:{archive:'/private/tmp/voxcode-test.bundle.gz',qup:'/usr/local/bin/qup-mac.2026'}});
});

test('does not package or upload when FETCH_HEAD is not a full commit revision',async()=>{
  const f=fixture();
  f.run=async(command,args)=>{f.calls.push({command,args});return {stdout:args[0]==='fetch'?'':'deadbeef\n'};};
  await assert.rejects(publishMaster({root,output:'/private/tmp/voxcode-test.bundle.gz',...f}),/full fetched master revision/u);
  assert.equal(f.calls.length,2);
});

test('does not upload a package whose manifest revision differs from fetched master',async()=>{
  const f=fixture();
  f.packageBundle=async options=>{f.calls.push({package:options});return {archive:options.output,revision:'b'.repeat(40),sha256:'b'.repeat(64)};};
  await assert.rejects(publishMaster({root,output:'/private/tmp/voxcode-test.bundle.gz',...f}),/Packager revision does not match/u);
  assert.equal(f.calls.length,3);
});

test('upload helper resolves relative QUP paths before changing its working directory',async()=>{
  const calls=[];
  const url=await uploadArtifact({
    archive:'/private/tmp/voxcode-test.bundle.gz',
    qup:'./tools/qup-mac.2026',
    run:async(command,args,options)=>{calls.push({command,args,options});return {stdout:'download url https://qup.example/test\n'};},
  });
  assert.equal(url,'https://qup.example/test');
  assert.equal(calls[0].args[0],'voxcode-test.bundle.gz');
  assert.equal(calls[0].options.cwd,'/private/tmp');
  assert.match(calls[0].command,/\/tools\/qup-mac\.2026$/u);
});

test('upload helper rejects QUP output without a download URL',async()=>{
  await assert.rejects(uploadArtifact({archive:'/private/tmp/voxcode-test.bundle.gz',qup:'qup-mac.2026',run:async()=>({stdout:'OK\n'})}),/download URL/u);
});

test('upload stops before QUP when the archive changes after packaging',async()=>{
  const f=fixture();
  f.verify=async()=>{f.calls.push({verify:'changed'});throw Error('Archive changed before upload');};
  await assert.rejects(publishMaster({root,output:'/private/tmp/voxcode-test.bundle.gz',...f}),/Archive changed/u);
  assert.equal(f.calls.at(-1).verify,'changed');
  assert.equal(f.calls.some(call=>call.upload),false);
});
