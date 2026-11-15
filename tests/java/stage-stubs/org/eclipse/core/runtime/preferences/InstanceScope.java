package org.eclipse.core.runtime.preferences;

/** Stage stub: no stored preferences, so every key falls back to its default. */
public final class InstanceScope {
    public static final InstanceScope INSTANCE = new InstanceScope();
    public Node getNode(String qualifier) { return new Node(); }
    public static final class Node {
        public boolean getBoolean(String key, boolean fallback) { return fallback; }
    }
}
