import fs from "node:fs";
const file = "retry-brain-count";
const count = fs.existsSync(file) ? Number(fs.readFileSync(file, "utf8")) + 1 : 1;
fs.writeFileSync(file, String(count));
if (count === 1) process.exitCode = 1;
else process.stdout.write(`you said: ${process.argv[2] || ""}`);
