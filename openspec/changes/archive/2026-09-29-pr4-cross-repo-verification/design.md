The workflow accepts `core_sha`, checks it strictly, exports it as `LITELLM_CORE_SHA`, and runs verify:dist, typecheck, test, and test:package. The existing CI remains unchanged.
