/**
 * The boot watchdog: an inline script in the document head that recovers from
 * a client that never boots (the entry module failed to load, or stalled).
 *
 * It lives here rather than in __root.tsx so it can be exercised directly by a
 * unit test; __root.tsx renders `bootWatchdogInlineScript()` into <head>.
 */

/** sessionStorage stamp of the last automatic reload, so it happens only once. */
export const BOOT_WATCHDOG_RETRY_KEY = "openrun:boot-retry-at";
const BOOT_RETRY_KEY = BOOT_WATCHDOG_RETRY_KEY;

/**
 * Window flag that turns the watchdog on in a development build.
 *
 * Development (the Lovable preview) keeps it off: Vite compiles modules on
 * demand, so a slow first load is normal there and must never be reloaded.
 * But the E2E suite only ever runs against the development server, so without
 * a way in, the recovery path that production depends on could not be tested
 * at all. A harness sets this flag before the document's own scripts run
 * (Playwright: `page.addInitScript`). Production builds ignore it: the
 * watchdog is always on there.
 */
export const BOOT_WATCHDOG_DEV_OPT_IN = "__openrun_boot_watchdog";

const BOOT_RETRY_CLEAR_SCRIPT = `try{sessionStorage.removeItem(${JSON.stringify(BOOT_RETRY_KEY)});}catch(e){}`;
export const BOOT_TIMEOUT_MS = 12_000;
/**
 * Absolute backstop, applied even while the page still looks busy. It only has
 * to bound the pathological "requests stream forever but the app never boots"
 * case, so it is deliberately generous: a cold mobile boot over a slow network
 * can legitimately run well past twenty seconds, and reloading such a page just
 * restarts the download with a *smaller* budget (see TIMEOUT below).
 */
const BOOT_HARD_TIMEOUT_MS = 60_000;
export const BOOT_PROGRESS_GRACE_MS = 4_000;

/**
 * Boot watchdog. Runs as a plain inline script (NOT a React effect) because the
 * failure it recovers from is "the client entry module never loaded" — in that
 * state no app code runs at all and the pre-hydration placeholder would sit on
 * screen forever. Reloads once, then surfaces a retry panel.
 */
const BOOT_WATCHDOG_SCRIPT = `(function(){
  var K=${JSON.stringify(BOOT_RETRY_KEY)};
  var START=Date.now();
  // Always the full budget: a shortened timeout after a recent retry turned
  // one transient delay into a repeating reload cycle.
  var TIMEOUT=${BOOT_TIMEOUT_MS};
  var HARD_TIMEOUT=${BOOT_HARD_TIMEOUT_MS};
  var PROGRESS_GRACE=${BOOT_PROGRESS_GRACE_MS};
  var lastResourceCount=0;
  var lastProgressAt=START;
  var sawComplete=0;
  var RE=/dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically imported module/i;
  function read(){try{return sessionStorage.getItem(K);}catch(e){return null;}}
  function write(v){try{sessionStorage.setItem(K,v);}catch(e){}}
  function booted(){return !!window.__openrun_booted;}
  function makeFailureHtml(){
    return '<p class="text-sm font-medium text-foreground">We could not finish loading</p>'+
      '<p class="mt-2 text-sm text-muted-foreground">Check your connection, then try again.</p>'+
      '<div class="mt-5 flex flex-wrap justify-center gap-2">'+
      '<button type="button" id="boot-retry" class="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Try again</button>'+
      '<a href="/auth" class="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground">Sign in again</a>'+
      '<a href="/" class="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground">Go home</a>'+
      '</div>';
  }
  function showFailure(){
    var el=document.getElementById('boot-fallback');
    if(el){
      el.innerHTML=makeFailureHtml();
    } else {
      var overlay=document.createElement('div');
      overlay.id='boot-fallback';
      overlay.className='fixed inset-0 z-50 grid place-items-center bg-background px-4';
      overlay.innerHTML='<div class="flex max-w-sm flex-col items-center text-center">'+makeFailureHtml()+'</div>';
      document.body.appendChild(overlay);
    }
    var b=document.getElementById('boot-retry');
    if(b)b.addEventListener('click',function(){try{sessionStorage.removeItem(K);}catch(e){}window.location.reload();});
  }
  function recover(force){
    if(booted())return;
    if(!force){showFailure();return;}
    var attemptedAt=Number(read()||'0');
    if(attemptedAt&&Date.now()-attemptedAt<120000){showFailure();return;}
    write(String(Date.now()));
    window.location.reload();
  }
  function resourceCount(){try{var o=location.origin;var e=performance.getEntriesByType('resource');var n=0;for(var i=0;i<e.length;i++){if(String(e[i].name).indexOf(o)===0)n++;}return n;}catch(e){return 0;}}
  function stillFetching(){try{return document.readyState!=='complete';}catch(e){return false;}}
  function checkProgress(){
    if(booted())return;
    var now=Date.now();
    var count=resourceCount();
    // A resource entry only appears once that request COMPLETES, so a single
    // slow module in flight looks identical to a dead page. An incomplete
    // document means the browser is still fetching something: that is progress,
    // not a stall, and reloading it would just restart the download.
    var fetching=stillFetching();
    // Hydration runs after the last request lands and is CPU-bound, so it emits
    // no resources at all. Give it its own grace window instead of counting the
    // wait as time already stalled. A page that never loads reaches 'complete'
    // almost immediately, so this costs a dead page nothing.
    if(!fetching&&!sawComplete){sawComplete=1;lastProgressAt=now;}
    if(count>lastResourceCount||fetching){lastResourceCount=count;lastProgressAt=now;}
    if(now-START>=HARD_TIMEOUT){recover(true);return;}
    if(now-START>=TIMEOUT&&now-lastProgressAt>=PROGRESS_GRACE){recover(true);return;}
    setTimeout(checkProgress,1000);
  }
  var ABORT=/abort/i;
  function onMessage(m,name){if(name==='AbortError'||ABORT.test(String(m)))return;if(m&&RE.test(String(m)))recover(true);}
  window.addEventListener('error',function(e){onMessage((e&&(e.message||(e.error&&e.error.message)))||'',e&&e.error&&e.error.name);});
  window.addEventListener('unhandledrejection',function(e){
    var r=e&&e.reason;onMessage((r&&r.message)||(typeof r==='string'?r:''),r&&r.name);
  });
  lastResourceCount=resourceCount();
  setTimeout(checkProgress,1000);
})();`;

/**
 * The script to inline in <head>. Production: the watchdog. Development: only
 * clear a retry stamp left over from an earlier cycle, unless the page was
 * opened with `window.__openrun_boot_watchdog === true` already set.
 */
export function bootWatchdogInlineScript(dev: boolean): string {
  if (!dev) return BOOT_WATCHDOG_SCRIPT;
  return `if(window.${BOOT_WATCHDOG_DEV_OPT_IN}===true){${BOOT_WATCHDOG_SCRIPT}}else{${BOOT_RETRY_CLEAR_SCRIPT}}`;
}
