# iBazel Benchmark Runner

This script runs iBazel on a specified target with the iBazel profiler enabled. After the initial build completes, it modifies a specified file by adding a newline to the end of it. The script reports the initial build time and the incremental build RTT.

It can also optionally launch chrome to a specified URL and report on the browser load RTT if the target (such as `ts_devserver`) serves a website.

## Reporting

The scripts outputs the RTT in ms as follows:

```
[ibazel-benchmark-runner] Initial build time 24059ms
[ibazel-benchmark-runner] Incremental build RTT 4192ms
[ibazel-benchmark-runner] Browser load RTT 4402ms
```

## Usage

`node_modules/.bin/ibazel-benchmark-runner <run_target> <file_to_modify> [--url=<url>] [--initial_timeout=<seconds>] [--incremental_timeout=<seconds>]`

| Argument | Description |
| ------------- | ------------- |
| `run_target` | The bazel target to run. |
| `file_to_modify` | The file to modify in order to start in incremental build (a newline will be added to the end of this file). |
| `url` | Url for the benchmark to navigate to in order to measure browser interactive RTT for incremental build (optional). |
| `initial_timeout` | Maximum time to wait for the initial build (defaults to 300 seconds). |
| `incremental_timeout` | Maximum time to wait for the incremental build (defaults to 15 seconds). |

For example:

`node_modules/.bin/ibazel-benchmark-runner //src:devserver src/foo/bar.ts --url=http://localhost:5432`
