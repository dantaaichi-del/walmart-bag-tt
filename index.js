// One Git extension entry point. Subcomponents retain relative assets/imports.
const VERSION='0.3.0-tt.1';
async function waitForContext(){
  await (window.__TAURITAVERN__?.ready??window.__TAURITAVERN_MAIN_READY__);
  for(let i=0;i<200;i++){
    if(window.SillyTavern?.getContext&&window.SillyTavern?.libs?.localforage)return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('TT 尚未提供扩展上下文，请重启应用后再试');
}
function nativeSurfaces(){
  const mapping=[['#wmb-bag','free-window'],['#wmb-orbit','free-window'],['#choco-player-root','free-window'],['#choco-player-panel','free-window'],['#mca-root','free-window'],['#mca-dialog','free-window'],['#butterfly-phone-standalone-v1','free-window'],['#butterfly-phone-standalone-v1-panel','free-window'],['#wmb-settings-dialog','free-window']];
  for(const [selector,surface]of mapping){const el=document.querySelector(selector);if(el)el.setAttribute('data-tt-mobile-surface',surface);}
}
async function boot(){
  await waitForContext();
  const names=[['播放器',()=>import('./components/chocolate-story-player/index-v161.js')],['午夜男高',()=>import('./components/midnight-cat-archive/index-v020.js')],['小蝴蝶',()=>import('./components/butterfly-phone/index.js')],['购物袋',()=>import('./components/walmart-shopping-bag/index-share.js')]];
  const failures=[];
  for(const [name,load]of names){try{await load();}catch(error){failures.push(name);console.error('[TT三件套] '+name+'加载失败',error);}}
  nativeSurfaces();
  const observer=new MutationObserver(nativeSurfaces);observer.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
  window.WalmartBagTT={version:VERSION,failures,check:()=>({shoppingBag:!!window.WalmartShoppingBag,music:!!window.ChocolateStoryPlayer,archive:!!window.MidnightCatArchive,phone:!!window.ButterflyPhoneStandalone,nativeMusicStorage:!!window.__TAURITAVERN__?.api?.extension?.store})};
  if(failures.length)window.toastr?.error?.('未能加载：'+failures.join('、')+'。请重启 TT。','沃尔玛购物袋');
}
boot().catch(error=>{console.error('[TT三件套]',error);window.toastr?.error?.(error.message,'沃尔玛购物袋');});
