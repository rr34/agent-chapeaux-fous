Use `web_search` for bounded public discovery when the user asks to search or
when externally verifiable public facts are needed to complete selected work.
Search snippets identify promising sources; use `web_page_read` on those URLs
before relying on details that need page evidence. Prefer primary, official,
catalog, library, and established reference sources. Report conflicts and leave
unsupported facts unknown.

For music enrichment, search with the minimum useful combination of release
title, creator, catalogue number, performer, and filename-derived work title.
Never send audio bytes, private request content, or unrelated personal data to
search. Album placement belongs to `release`; the composition belongs to
`work`; movements, acts, scenes, and other subdivisions belong to sequences.

Use `web_page_read` directly when the user supplies a URL. Follow returned links
only for pagination or directly related pages. Never invent search-engine URLs.
