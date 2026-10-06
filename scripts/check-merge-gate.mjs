#!/usr/bin/env node
/**
 * Required merge-gate drift check for the Pi repository (same-class guard as
 * opencode-litellm-provider/scripts/check-merge-gate.mjs).
 *
 * Freezes the `Protect main` ruleset baseline:
 *   - active enforcement on refs/heads/main
 *   - strict required status checks
 *   - check contexts exactly { CI, Real Pi 0.87.1 E2E }
 *   - squash-only merge method, no bypass actors
 *   - review-thread resolution, deletion + non-fast-forward protection
 */
import { execFileSync } from "node:child_process"

const REPO = "rpchen/pi-litellm-provider"
const RULESET_NAME = "Protect main"
const REQUIRED_CHECKS = ["CI", "Real Pi 0.87.1 E2E"]
const EXPECTED = {
  enforcement: "active",
  allowedMergeMethods: ["squash"],
  reviewThreadResolution: true,
  bypassActors: 0,
}

function ghApi(path) {
  const stdout = execFileSync("gh", ["api", path], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  })
  return JSON.parse(stdout)
}

const failures = []
function require(condition, message) {
  if (!condition) failures.push(message)
}

const rulesets = ghApi(`repos/${REPO}/rulesets`)
const ruleset = (Array.isArray(rulesets) ? rulesets : []).find(
  (entry) => entry.name === RULESET_NAME,
)
require(ruleset !== undefined, `ruleset "${RULESET_NAME}" not found on ${REPO}`)

if (ruleset) {
  require(
    ruleset.enforcement === EXPECTED.enforcement,
    `enforcement drifted: ${ruleset.enforcement} != ${EXPECTED.enforcement}`,
  )
  const full = ghApi(`repos/${REPO}/rulesets/${ruleset.id}`)
  const include = full.conditions?.ref_name?.include ?? []
  require(
    include.includes("refs/heads/main"),
    `ruleset no longer targets refs/heads/main (include: ${JSON.stringify(include)})`,
  )

  const statusRule = (full.rules ?? []).find((rule) => rule.type === "required_status_checks")
  require(statusRule !== undefined, "required_status_checks rule is missing")
  if (statusRule) {
    require(
      statusRule.parameters?.strict_required_status_checks_policy === true,
      "strict_required_status_checks_policy drifted off",
    )
    const contexts = (statusRule.parameters?.required_status_checks ?? []).map((check) => check.context)
    for (const expected of REQUIRED_CHECKS) {
      require(
        contexts.includes(expected),
        `required status check missing: "${expected}" (current: ${JSON.stringify(contexts)})`,
      )
    }
    const extra = contexts.filter((context) => !REQUIRED_CHECKS.includes(context))
    require(extra.length === 0, `unexpected extra required checks: ${JSON.stringify(extra)}`)
  }

  const pullRule = (full.rules ?? []).find((rule) => rule.type === "pull_request")
  require(pullRule !== undefined, "pull_request rule is missing")
  if (pullRule) {
    require(
      JSON.stringify(pullRule.parameters?.allowed_merge_methods ?? []) ===
        JSON.stringify(EXPECTED.allowedMergeMethods),
      `allowed merge methods drifted: ${JSON.stringify(pullRule.parameters?.allowed_merge_methods)}`,
    )
    require(
      pullRule.parameters?.required_review_thread_resolution === true,
      "review-thread resolution requirement drifted off",
    )
  }
  require(
    (full.bypass_actors ?? []).length === EXPECTED.bypassActors,
    `bypass actors drifted: ${JSON.stringify(full.bypass_actors)}`,
  )
  const types = (full.rules ?? []).map((rule) => rule.type)
  require(types.includes("deletion"), "branch deletion protection drifted off")
  require(types.includes("non_fast_forward"), "non-fast-forward protection drifted off")
}

if (failures.length > 0) {
  console.error("Pi Protect-main merge-gate drift detected:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `merge gate ok: "${RULESET_NAME}" requires ${JSON.stringify(REQUIRED_CHECKS)} with all other protections unchanged`,
)