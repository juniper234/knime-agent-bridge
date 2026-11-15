import test from 'node:test';
import assert from 'node:assert/strict';
import {manifestHeaders, exportedPackages, constantPoolReferences, elementType} from '../scripts/api-surface.mjs';

test('manifest headers join continuation lines', () => {
  const headers = manifestHeaders('Bundle-SymbolicName: org.example.a;singleton:=true\r\nExport-Package: org.example.a,\r\n org.example.b;version="1.0"\r\n');
  assert.equal(headers['Bundle-SymbolicName'], 'org.example.a;singleton:=true');
  assert.equal(headers['Export-Package'], 'org.example.a,org.example.b;version="1.0"');
});

test('exported packages ignore commas inside quoted attributes and keep visibility markers', () => {
  const packages = exportedPackages('org.a;uses:="org.b,org.c";version="1",org.d;x-internal:=true,org.e;x-friends:="org.f"');
  assert.deepEqual(packages.map(p => p.name), ['org.a', 'org.d', 'org.e']);
  assert.equal(packages[1].internal, true);
  assert.equal(packages[2].friends, true);
  assert.equal(packages[0].internal || packages[0].friends, false);
});

test('array owners unwrap to their element type; primitive arrays are dropped', () => {
  assert.equal(elementType('[Lorg/knime/core/node/NodeModel;'), 'org/knime/core/node/NodeModel');
  assert.equal(elementType('[[Lorg/x/Y;'), 'org/x/Y');
  assert.equal(elementType('[B'), null);
  assert.equal(elementType('org/x/Y'), 'org/x/Y');
});

test('constant pool parsing reads classes, methods, interface methods and fields', () => {
  const output = [
    '   #7 = Class              #9            // org/knime/core/node/workflow/WorkflowManager',
    '  #12 = Methodref          #7.#13        // org/knime/core/node/workflow/WorkflowManager.getID:()Lorg/knime/core/node/workflow/NodeID;',
    '  #20 = InterfaceMethodref #21.#22       // org/eclipse/ui/IWorkbench.getDisplay:()Lorg/eclipse/swt/widgets/Display;',
    '  #30 = Fieldref           #31.#32       // org/eclipse/swt/SWT.APPLICATION_MODAL:I',
    '  #40 = Methodref          #41.#42       // "[Lorg/knime/agent/X;".clone:()Ljava/lang/Object;',
    '  #50 = Utf8               ignored',
  ].join('\n');
  assert.deepEqual(constantPoolReferences(output), [
    {kind: 'class', owner: 'org/knime/core/node/workflow/WorkflowManager'},
    {kind: 'method', owner: 'org/knime/core/node/workflow/WorkflowManager', member: 'getID', descriptor: '()Lorg/knime/core/node/workflow/NodeID;'},
    {kind: 'method', owner: 'org/eclipse/ui/IWorkbench', member: 'getDisplay', descriptor: '()Lorg/eclipse/swt/widgets/Display;'},
    {kind: 'field', owner: 'org/eclipse/swt/SWT', member: 'APPLICATION_MODAL', descriptor: 'I'},
    {kind: 'method', owner: 'org/knime/agent/X', member: 'clone', descriptor: '()Ljava/lang/Object;'},
  ]);
});
