'use strict';
(() => {
  let prefs={font_size:16,depth:'field'}, api=null, timer;
  try {Object.assign(prefs,JSON.parse(localStorage.getItem('separator.display')||'{}'));}catch{}
  function apply(value={}){
    for(const [key,allowed] of Object.entries({font_size:[16,18,20],depth:['field','deep']}))if(allowed.includes(value[key]))prefs[key]=value[key];
    delete prefs.theme;document.documentElement.dataset.theme='dark';
    document.documentElement.style.setProperty('--reader-size',prefs.font_size+'px');
    const size=document.getElementById('reading-size'),depth=document.getElementById('analysis-depth');if(size)size.value=prefs.font_size;if(depth)depth.value=prefs.depth;
    try{localStorage.setItem('separator.display',JSON.stringify(prefs));}catch{}
  }
  function change(value){apply(value);clearTimeout(timer);timer=setTimeout(()=>{if(api)api('/api/config',{action:'preferences',preferences:prefs}).catch(()=>window.dispatchEvent(new Event('separator-preference-error')));},180);}
  window.WorkbenchPreferences={apply,get:()=>({...prefs}),connect:(fn,value)=>{api=fn;apply(value);}};
  apply(prefs);
  document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('reading-size').addEventListener('change',e=>change({font_size:Number(e.target.value)}));
    document.getElementById('analysis-depth').addEventListener('change',e=>change({depth:e.target.value}));
    apply();
  });
})();
