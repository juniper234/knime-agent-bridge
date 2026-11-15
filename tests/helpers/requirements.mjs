// Skip reasons for tests that need more than Node. Each value is false when the
// requirement is met, otherwise a short reason string for node:test's `skip`.
//
//   KNIME_AGENT_LIVE=1   run tests that talk to a running bridge-enabled KNIME
//   KNIME_HOME           KNIME install used for compiling Java harnesses
import {existsSync} from 'node:fs';
import path from 'node:path';
import {findKnimeHome, hasJdk, root} from '../../scripts/lib/java-toolchain.mjs';

const knime = findKnimeHome();
const jdk = hasJdk();

/** A JDK is available (javac). */
export const needsJdk = jdk ? false : 'needs a JDK 21+ (set JAVA_HOME or KNIME_AGENT_JDK)';

/** An installed KNIME to compile against, plus a JDK. */
export const needsKnime = needsJdk || (knime && existsSync(path.join(knime, 'plugins')) ? false : 'needs an installed KNIME (set KNIME_HOME)');

/** Bridge classes from `node scripts/build.mjs` (build/classes and build/javac.args). */
export const needsBuild = needsKnime || (existsSync(path.join(root, 'build', 'javac.args')) && existsSync(path.join(root, 'build', 'classes')) ? false : 'needs `node scripts/build.mjs` first');

/** A running KNIME with the bridge. Opt in, because these tests mutate a synthetic workspace. */
export const needsLive = process.env.KNIME_AGENT_LIVE === '1' ? false : 'needs a running bridge-enabled KNIME (set KNIME_AGENT_LIVE=1)';

/** Windows-only behavior (sharing locks, PowerShell, Kernel32). */
export const needsWindows = process.platform === 'win32' ? false : 'Windows only';
