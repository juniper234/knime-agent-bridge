package org.knime.agent;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.eclipse.core.runtime.preferences.InstanceScope;
import org.knime.gateway.impl.project.ProjectManager;

/**
 * Whether agents are limited to the workflows that are open in this KNIME. On by default; the
 * user can turn it off in Preferences > KNIME > Agent Bridge. When on, agents cannot browse,
 * open, create, move, rename or delete items in any space, every gateway call must name an open
 * project, and files are written only inside the bridge runtime directory.
 * The system property overrides the preference for the developer launcher and tests.
 */
final class ScopePolicy {
    static final String KEY="openWorkflowsOnly";
    static final String PROPERTY="knime.agent.openWorkflowsOnly";
    static final boolean DEFAULT=true;
    /** Gateway methods that name no project and cannot reach saved workflows or files. */
    static final Set<String> PROJECT_FREE_GATEWAY=Set.of("ApplicationService.getState",
        "NodeRepositoryService.getNodeCategory","NodeRepositoryService.getNodeTemplates","NodeRepositoryService.getNodesGroupedByTags",
        "NodeRepositoryService.searchNodes","NodeService.getNodeDescription");
    static final Set<String> BLOCKED_OPERATIONS=Set.of("desktop.openProject");
    record State(boolean openOnly,String source){}
    private ScopePolicy(){}

    /** Read on every dispatch so a preference change applies without restart. */
    static State current() {
        String property=System.getProperty(PROPERTY);
        if(property!=null&&!property.isBlank())return new State(Boolean.parseBoolean(property.trim()),"system-property");
        try {return new State(InstanceScope.INSTANCE.getNode(WritePolicy.NODE).getBoolean(KEY,DEFAULT),"preference");}
        catch(Throwable unreadable) {return new State(DEFAULT,"default");}
    }

    static ObjectNode describe() {
        State state=current();
        ObjectNode out=BridgeActivator.JSON.createObjectNode().put("openWorkflowsOnly",state.openOnly()).put("source",state.source()).put("changeAt",WritePolicy.WHERE);
        out.set("blockedOperations",BridgeActivator.JSON.valueToTree(BLOCKED_OPERATIONS.stream().sorted().toList()));
        out.set("projectFreeGatewayMethods",BridgeActivator.JSON.valueToTree(PROJECT_FREE_GATEWAY.stream().sorted().toList()));
        out.put("gatewayRule","Every other gateway method must name an open projectId; SpaceService methods name none and are refused");
        out.put("fileRule","core.port.export writes only inside the bridge runtime directory; dependency.inspect expectedRoot is refused");
        return out;
    }

    /** Refuses before acceptance: no receipt is written and nothing reaches KNIME. */
    static void require(String operation,JsonNode args,Path runtime) {
        State state=current();
        if(!state.openOnly())return;
        if(BLOCKED_OPERATIONS.contains(operation))
            refuse(state,operation,args,"Agents can only use workflows that are already open in KNIME. Ask the user to open the workflow.");
        if(operation.equals("gateway.call"))gateway(state,args);
        if(operation.equals("core.port.export"))exportPath(state,args,runtime);
        if(operation.equals("dependency.inspect"))for(JsonNode check:args.path("pathChecks"))
            if(check.has("expectedRoot"))refuse(state,operation,args,"expectedRoot can name folders outside the open workflows; omit it to compare with the workflow's own folder.");
    }

    private static void gateway(State state,JsonNode args) {
        String method=args.path("method").asText();
        if(PROJECT_FREE_GATEWAY.contains(method))return;
        int index=GatewayAccess.parameterIndex(method,"projectId");
        if(index<0)refuse(state,"gateway.call",args,method+" does not act on an open workflow, so it is not available to agents in this KNIME.");
        JsonNode params=args.path("params");
        JsonNode value=params.isArray()?params.path(index):params.path("projectId");
        String projectId=value.isTextual()?value.asText():"";
        if(!openProjects().contains(projectId))
            refuse(state,"gateway.call",args,"projectId "+(projectId.isEmpty()?"(missing)":projectId)+" is not a workflow open in KNIME.");
    }

    private static void exportPath(State state,JsonNode args,Path runtime) {
        JsonNode value=args.path("path");
        if(!value.isTextual()||value.asText().isBlank())return; // CoreAccess reports the missing path.
        try {
            Path target=Path.of(value.asText()).toAbsolutePath().normalize(),parent=target.getParent();
            Path root=Files.isDirectory(runtime)?runtime.toRealPath():runtime;
            Path realParent=parent!=null&&Files.isDirectory(parent)?parent.toRealPath():parent;
            if(realParent!=null&&realParent.startsWith(root))return;
        }catch(Exception unresolved){/* refused below */}
        refuse(state,"core.port.export",args,"Exports go only inside the bridge runtime directory "+runtime+" in this KNIME.");
    }

    static List<String> openProjects() {
        try {return ProjectManager.getInstance().getProjectIds();}
        catch(Throwable unavailable) {return List.of();}
    }

    private static void refuse(State state,String operation,JsonNode args,String reason) {
        ObjectNode details=BridgeActivator.JSON.createObjectNode().put("operation",operation).put("scopePolicySource",state.source()).put("changeAt",WritePolicy.WHERE);
        if(operation.equals("gateway.call"))details.put("method",args.path("method").asText());
        throw new ContextAccess.Conflict("SCOPE_RESTRICTED",reason+" A user can change this in "+WritePolicy.WHERE+".",details);
    }
}
