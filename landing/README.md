# Public introduction

`index.html` is the standalone, three-paragraph landing page for
`https://chapeauxfous.com/`. Open it directly in a browser to preview it. It needs
no build step, JavaScript, external assets, application server, or database.

For publication, copy only `index.html` into a dedicated static website root
(for example, `/srv/chapeauxfous-landing`) and configure the domain's HTTPS web
server to serve that directory. Confirm the domain's DNS and certificate during
deployment. Do not use the repository root or the private application's `public/`
directory as this website's root. The public site does not need an upstream
connection to the Agent application.

Publishing the file, configuring DNS/TLS, and reloading the public web server are
separate live-system actions requiring Nate's explicit request under `AGENTS.md`.
Adding this directory does not publish the page or change the private app's home
page.

Copy is grounded in `README.md`, `config/hats.json`, the identity and request
path descriptions in `src/agent-self-knowledge.mjs`, and Nate's stated “all or
none” product goal.
