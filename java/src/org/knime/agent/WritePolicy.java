package org.knime.agent;

import org.eclipse.core.runtime.preferences.InstanceScope;

/**
 * Whether agents may change, run or save anything. On by default; the user can turn it off in
 * Preferences > KNIME > Agent Bridge. The system property overrides the preference so the
 * developer launcher and tests keep their v0.5 behavior.
 */
final class WritePolicy {
    static final String NODE="io.github.juniper234.knime.agentbridge";
    static final String KEY="allowWrites";
    static final String PROPERTY="knime.agent.allowWrites";
    static final String WHERE="KNIME > Preferences > KNIME > Agent Bridge";
    static final boolean DEFAULT=true;
    record State(boolean enabled,String source){}
    private WritePolicy(){}

    /** Read on every dispatch so a preference change applies without restart. */
    static State current() {
        String property=System.getProperty(PROPERTY);
        if(property!=null&&!property.isBlank())return new State(Boolean.parseBoolean(property.trim()),"system-property");
        try {return new State(InstanceScope.INSTANCE.getNode(NODE).getBoolean(KEY,DEFAULT),"preference");}
        catch(Throwable unreadable) {return new State(DEFAULT,"default");}
    }
}
