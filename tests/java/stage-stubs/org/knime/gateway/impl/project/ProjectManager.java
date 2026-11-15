package org.knime.gateway.impl.project;
import java.util.*;
import java.util.concurrent.*;

/** Stage stub: the harness decides which project IDs count as open. */
public final class ProjectManager {
    private static final ProjectManager INSTANCE=new ProjectManager();
    public static final List<String> OPEN=new CopyOnWriteArrayList<>();
    public static ProjectManager getInstance(){return INSTANCE;}
    public List<String> getProjectIds(){return List.copyOf(OPEN);}
}
