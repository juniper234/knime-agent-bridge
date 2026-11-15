package org.knime.agent;

import java.nio.file.Path;

/** The bridge runtime directory shared with the Node MCP server and CLI. */
final class RuntimeDirectory {
    static final String PROPERTY="knime.agent.runtime";
    private RuntimeDirectory(){}

    /** -Dknime.agent.runtime when set, otherwise ~/.knime-agent/runtime (the Node default). */
    static Path resolve() {
        String configured=System.getProperty(PROPERTY);
        Path root=configured==null||configured.isBlank()?Path.of(System.getProperty("user.home"),".knime-agent","runtime"):Path.of(configured);
        return root.toAbsolutePath().normalize();
    }
}
