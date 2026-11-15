package org.knime.agent;

import java.util.*;
import java.util.concurrent.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.eclipse.core.runtime.Platform;
import org.eclipse.swt.widgets.Display;
import org.eclipse.ui.PlatformUI;

/**
 * Reads what the user has selected on the KNIME canvas.
 *
 * KNIME keeps canvas selection only in its browser UI (a Pinia store), never in Java, so this
 * runs one fixed, read-only script in the editor browser. The script is a constant: no agent
 * input reaches it except a bridge-generated UUID used as a session-storage key, through which
 * the result comes back. The store layout is internal to KNIME and may change in any release;
 * the result then reports available:false instead of failing.
 */
final class SelectionAccess {
    static final String SOURCE="knime-ui-internal-state";
    static final int LIMIT=500;
    private static final String EDITOR="https://org.knime.ui.java/editor/index.html";
    private static final String SCRIPT="(function(k){var r;try{"
        +"var el=document.querySelector('#app'),app=el&&el.__vue_app__,p=app&&app.config&&app.config.globalProperties.$pinia,"
        +"s=p&&p._s&&p._s.get('selection'),w=p&&p._s&&p._s.get('workflow');"
        +"if(!s||!w){r={available:false,reason:'KNIME UI selection store not found'};}"
        +"else{var a=w.activeWorkflow,ids=function(v){return Array.isArray(v)?v.slice(0,"+LIMIT+").map(String):[];};"
        +"r={available:true,projectId:a&&a.projectId||null,workflowId:a&&a.info&&a.info.containerId||null,"
        +"nodeIds:ids(s.selectedNodeIds),annotationIds:ids(s.selectedAnnotationIds),connectionIds:ids(s.selectedConnectionIds),"
        +"truncated:[s.selectedNodeIds,s.selectedAnnotationIds,s.selectedConnectionIds].some(function(v){return Array.isArray(v)&&v.length>"+LIMIT+";})};}"
        +"}catch(e){r={available:false,reason:String(e&&e.message||e).slice(0,200)};}"
        +"sessionStorage.setItem(k,JSON.stringify(r));})(%s);";

    private SelectionAccess(){}

    static ObjectNode read()throws Exception {
        var bundle=Platform.getBundle("com.equo.chromium");
        if(bundle==null)throw new UnsupportedOperationException("Selection needs KNIME's embedded browser (com.equo.chromium)");
        Class<?> api=bundle.loadClass("com.equo.chromium.ChromiumBrowser");
        Display display=PlatformUI.getWorkbench().getDisplay();
        if(Display.getCurrent()==display)throw new IllegalStateException("Selection read must not wait on SWT");
        String key="knime-agent-selection-"+UUID.randomUUID();
        CompletableFuture<Object> started=new CompletableFuture<>();
        display.asyncExec(()->{
            try {
                List<Object> editors=new ArrayList<>();
                for(Object browser:(Collection<?>)api.getMethod("getAllBrowsers").invoke(null)) {
                    String url=(String)api.getMethod("getUrl").invoke(browser);
                    if(url!=null&&url.split("[?#]",2)[0].equals(EDITOR))editors.add(browser);
                }
                if(editors.size()!=1)throw new IllegalStateException("Expected exactly one KNIME editor browser; found "+editors.size());
                api.getMethod("executeJavaScript",String.class).invoke(editors.get(0),String.format(Locale.ROOT,SCRIPT,BridgeActivator.JSON.writeValueAsString(key)));
                started.complete(editors.get(0));
            }catch(Throwable e){started.completeExceptionally(e);}
        });
        Object browser;
        try{browser=started.get(3,TimeUnit.SECONDS);}catch(TimeoutException e){started.cancel(false);throw new TimeoutException("KNIME UI thread did not run the selection read within 3 s");}
        Object storage=api.getMethod("getSessionStorage").invoke(browser);
        var getItem=storage.getClass().getMethod("getItem",String.class);
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
        String raw=null;
        while(raw==null&&System.nanoTime()<deadline) {
            raw=(String)((CompletableFuture<?>)getItem.invoke(storage,key)).get(1,TimeUnit.SECONDS);
            if(raw==null)Thread.sleep(25);
        }
        try{storage.getClass().getMethod("remove",String.class).invoke(storage,key);}catch(Exception ignored){}
        if(raw==null)throw new TimeoutException("KNIME UI did not report its selection within 3 s");
        if(raw.length()>256*1024)throw new IllegalStateException("Selection result exceeds 256 KiB");
        JsonNode parsed=BridgeActivator.JSON.readTree(raw);
        if(!parsed.isObject())throw new IllegalStateException("Selection result is not an object");
        ObjectNode out=(ObjectNode)parsed;
        var ui=Platform.getBundle("org.knime.ui.java");
        out.put("source",SOURCE).put("knimeUiVersion",ui==null?"unknown":ui.getVersion().toString())
           .put("stability","Read from KNIME's internal UI state; a KNIME update can change it. Re-read before acting on it.");
        return out;
    }
}
