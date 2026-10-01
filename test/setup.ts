// Hermetic tests: never read or write the real ~/.pi/agent (activation, auth, models store).
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-litellm-test-agent-"))
delete process.env.LITELLM_BASE_URL
delete process.env.LITELLM_API_KEY
