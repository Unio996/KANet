// 共享 RUNTIME_SCOPE_DIRS 真值源(2026-07-25, B2 加固时从 G5 抽取)——G5 gate③
// runtime-equivalence 判定 + health.js 启动时算 load-bearing digest 两处都要用同一份 scope
// 定义, 不能各自维护(维护两份同名概念漂移是这轮暴露的教训, 见
// docs/2026-07-25-j2-g5-b1-b6-hardening-design.md B2)。
//
// 🔴 抽取时顺手修的 bug: 原来 G5 里写的是裸 'package.json'/'package-lock.json'(相对 repo
// ROOT), 但这两个文件实际只存在于 kasia-console/ 目录下(仓库根目录从未有过 package.json,
// `git log --all -- package.json` 核实过零历史)——git diff 对不存在的路径静默返回空 diff,
// 这个 scope 条目此前一直是个静默 no-op, 从没真的检测过依赖声明变动。改成正确的
// kasia-console/ 前缀路径。
//
// 已知局限如实标注(非隐藏): node_modules 太大且 gitignore, 不纳入 scope 范围。
export const RUNTIME_SCOPE_DIRS = [
  'kasia-console/src',
  'kasia-relay/src',
  'kasia-console/package.json',
  'kasia-console/package-lock.json',
];
