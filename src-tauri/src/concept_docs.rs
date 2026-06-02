//! 概念 → 权威文档映射（M2 外部知识源第一层：确定性、离线、零风险）。
//!
//! 背景：概念卡的 learnMore 此前是 LLM 生成的 URL，可能编造或失效。这里维护一份
//! 常见编程概念/模式 → 官方文档的映射，对 LLM 给出的概念卡做覆盖/补全：命中映射则
//! 用权威链接替换并标记 verified=true（UI 显示「官方」徽章），未命中保留 LLM 的链接。
//!
//! 匹配按概念名归一化后做包含匹配，覆盖常见别名（如 "DI" / "Dependency Injection"）。
//! 后续可叠加 Context7 实时查询作为第二层增强（未命中本地映射时）。

/// 归一化概念名：转小写、去掉非字母数字、合并空格，便于稳健匹配。
fn normalize(name: &str) -> String {
  name
    .to_lowercase()
    .chars()
    .map(|c| if c.is_alphanumeric() { c } else { ' ' })
    .collect::<String>()
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ")
}

/// (匹配关键词归一化形, 官方文档 URL)。关键词按「归一化后包含」匹配。
/// 顺序敏感：更具体的放前面，命中即返回。
const CONCEPT_DOCS: &[(&str, &str)] = &[
  // React 生态
  (
    "react server components",
    "https://react.dev/reference/rsc/server-components",
  ),
  (
    "server components",
    "https://react.dev/reference/rsc/server-components",
  ),
  ("react hooks", "https://react.dev/reference/react/hooks"),
  ("use effect", "https://react.dev/reference/react/useEffect"),
  ("use state", "https://react.dev/reference/react/useState"),
  (
    "use context",
    "https://react.dev/reference/react/useContext",
  ),
  ("suspense", "https://react.dev/reference/react/Suspense"),
  ("hooks", "https://react.dev/reference/react/hooks"),
  // 状态管理
  ("redux saga", "https://redux-saga.js.org/"),
  ("saga", "https://redux-saga.js.org/"),
  ("redux", "https://redux.js.org/"),
  (
    "zustand",
    "https://docs.pmnd.rs/zustand/getting-started/introduction",
  ),
  // 架构模式
  (
    "dependency injection",
    "https://en.wikipedia.org/wiki/Dependency_injection",
  ),
  (
    "inversion of control",
    "https://en.wikipedia.org/wiki/Inversion_of_control",
  ),
  (
    "repository pattern",
    "https://martinfowler.com/eaaCatalog/repository.html",
  ),
  (
    "observer pattern",
    "https://refactoring.guru/design-patterns/observer",
  ),
  (
    "factory pattern",
    "https://refactoring.guru/design-patterns/factory-method",
  ),
  (
    "singleton",
    "https://refactoring.guru/design-patterns/singleton",
  ),
  (
    "middleware",
    "https://expressjs.com/en/guide/using-middleware.html",
  ),
  (
    "event sourcing",
    "https://martinfowler.com/eaaDev/EventSourcing.html",
  ),
  ("cqrs", "https://martinfowler.com/bliki/CQRS.html"),
  // 异步/并发
  (
    "async await",
    "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function",
  ),
  (
    "promise",
    "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise",
  ),
  ("tokio", "https://tokio.rs/"),
  ("goroutine", "https://go.dev/tour/concurrency/1"),
  // Web/协议
  (
    "server sent events",
    "https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events",
  ),
  (
    "websocket",
    "https://developer.mozilla.org/en-US/docs/Web/API/WebSocket",
  ),
  ("graphql", "https://graphql.org/learn/"),
  ("grpc", "https://grpc.io/docs/"),
  (
    "rest",
    "https://developer.mozilla.org/en-US/docs/Glossary/REST",
  ),
  ("oauth", "https://oauth.net/2/"),
  ("jwt", "https://jwt.io/introduction"),
  // 构建/框架
  ("tauri", "https://tauri.app/"),
  ("next js", "https://nextjs.org/docs"),
  ("nextjs", "https://nextjs.org/docs"),
  ("tailwind", "https://tailwindcss.com/docs"),
  ("vite", "https://vite.dev/"),
  // 数据
  (
    "orm",
    "https://en.wikipedia.org/wiki/Object%E2%80%93relational_mapping",
  ),
  ("prisma", "https://www.prisma.io/docs"),
  ("sqlite", "https://www.sqlite.org/docs.html"),
  ("fts5", "https://www.sqlite.org/fts5.html"),
];

/// 查权威文档 URL。命中返回 Some(url)，未命中 None（保留 LLM 的链接）。
pub fn lookup(concept_name: &str) -> Option<&'static str> {
  let n = normalize(concept_name);
  if n.is_empty() {
    return None;
  }
  for (kw, url) in CONCEPT_DOCS {
    if n.contains(kw) {
      return Some(url);
    }
  }
  None
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn matches_common_concepts() {
    assert_eq!(
      lookup("Dependency Injection"),
      Some("https://en.wikipedia.org/wiki/Dependency_injection")
    );
    assert_eq!(
      lookup("DI (Dependency Injection)"),
      Some("https://en.wikipedia.org/wiki/Dependency_injection")
    );
    assert_eq!(lookup("Redux-Saga"), Some("https://redux-saga.js.org/"));
    assert_eq!(
      lookup("React Server Components"),
      Some("https://react.dev/reference/rsc/server-components")
    );
    assert_eq!(lookup("Tauri"), Some("https://tauri.app/"));
  }

  #[test]
  fn returns_none_for_unknown() {
    assert_eq!(lookup("SomeProprietaryInternalThing"), None);
    assert_eq!(lookup(""), None);
  }

  #[test]
  fn normalize_handles_punctuation_and_case() {
    assert_eq!(normalize("Async/Await!"), "async await");
    assert_eq!(normalize("  gRPC  "), "grpc");
  }
}
