package org.knime.agent;

import org.eclipse.core.runtime.preferences.InstanceScope;
import org.eclipse.jface.preference.BooleanFieldEditor;
import org.eclipse.jface.preference.FieldEditorPreferencePage;
import org.eclipse.swt.SWT;
import org.eclipse.swt.widgets.Label;
import org.eclipse.ui.IWorkbench;
import org.eclipse.ui.IWorkbenchPreferencePage;
import org.eclipse.ui.preferences.ScopedPreferenceStore;

/** Preferences > KNIME > Agent Bridge. */
public final class AgentBridgePreferencePage extends FieldEditorPreferencePage implements IWorkbenchPreferencePage {
    public AgentBridgePreferencePage() {
        super(GRID);
        ScopedPreferenceStore store=new ScopedPreferenceStore(InstanceScope.INSTANCE,WritePolicy.NODE);
        store.setDefault(WritePolicy.KEY,WritePolicy.DEFAULT);
        store.setDefault(ScopePolicy.KEY,ScopePolicy.DEFAULT);
        setPreferenceStore(store);
        setDescription("AI agents connected through the Agent Bridge can always read open workflows, settings and tables. "
            +"Turn off the first option to keep them read-only. The second option keeps them away from workflows you have not opened.");
    }
    @Override public void init(IWorkbench workbench) {}
    @Override protected void createFieldEditors() {
        addField(new BooleanFieldEditor(WritePolicy.KEY,"Allow AI agents to modify, execute and save workflows",getFieldEditorParent()));
        overrideNote(WritePolicy.PROPERTY);
        addField(new BooleanFieldEditor(ScopePolicy.KEY,"Only allow AI agents to use workflows that are open in KNIME",getFieldEditorParent()));
        Label scope=new Label(getFieldEditorParent(),SWT.WRAP);
        scope.setText("Agents cannot browse, open, create, move, rename or delete items in your spaces, and export files only into the Agent Bridge folder. "
            +"Nodes they run can still read the files those nodes are configured with.");
        overrideNote(ScopePolicy.PROPERTY);
    }
    private void overrideNote(String key) {
        String property=System.getProperty(key);
        if(property!=null&&!property.isBlank()) {
            Label note=new Label(getFieldEditorParent(),SWT.WRAP);
            note.setText("This KNIME was started with -D"+key+"="+property.trim()+", which overrides the setting above.");
        }
    }
}
