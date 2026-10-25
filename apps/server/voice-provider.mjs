// Reuse the repository voice SDK through explicit runtime injection. No provider
// credentials or project-selection authority crosses into browser messages.
export function createLinxVoiceProvider({config,createSession,createDecoder,onEvent=()=>{}}={}) {
  if(!config||typeof createSession!=='function')throw Error('Voice SDK configuration required');
  let closed=false,failed=false,ready=false,decoder,output=null,metadata;
  const emit=event=>{if(!closed)onEvent(event);};
  const session=createSession({config,tools:[],onEvent:event=>{
    if(closed||failed)return;
    if(event.type==='ready')metadata=event.audioParams;
    else if(event.type==='error')emit({type:'error',code:'voice_provider_failed'});
    else if(event.type==='stt'&&typeof event.text==='string'){
      // Linx sends this service notice through the STT channel before its error.
      if(event.text.replace(/[\s\p{P}]/gu,'')==='额度不足请联系灵矽商务'){failed=true;emit({type:'error',code:'voice_provider_failed'});}
      else emit({type:'stt.final',text:event.text.slice(0,4000)});
    }
    else if(event.type==='tts'&&['start','stop','sentence_start'].includes(event.state))emit({type:'assistant.event',state:event.state,...(typeof event.text==='string'?{text:event.text.slice(0,4000)}:{}),...(event.is_aborted===true?{aborted:true}:{})});
    else if(event.type==='audio'&&decoder){try{const data=decoder.decode(event.data);emit({type:'audio',data,format:output});}catch{emit({type:'error',code:'voice_audio_invalid'});}}
  }});
  return {
    async connect(){
      await session.connect();if(closed)throw Error('Voice provider closed');
      if(metadata&&typeof createDecoder==='function'){
        try{decoder=createDecoder(metadata);output={codec:'pcm_s16le',sampleRate:metadata.sample_rate,channels:1};}catch{output=null;}
      }
      ready=true;
      return {input:{codec:'pcm_s16le',sampleRate:16000,channels:1,frameMs:20},output,writeReady:false,writeBlocker:'cloud_mcp_session_correlation_unverified'};
    },
    start(){if(!ready||closed)throw Error('Voice provider unavailable');session.startListening();},
    sendAudio(data){if(!ready||closed)throw Error('Voice provider unavailable');session.sendAudio(data);},
    stop(){if(ready&&!closed)session.stopListening();},
    abort(){if(ready&&!closed)session.abort();},
    close(){if(closed)return;closed=true;decoder?.close();session.close();},
  };
}
