export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "portal.maiaenergiasrenovaveis.com.br" && !url.pathname.startsWith("/portal")) {
      url.pathname = url.pathname === "/" ? "/portal" : "/portal" + url.pathname;
      return env.ASSETS.fetch(new Request(url, request));
    }

    return env.ASSETS.fetch(request);
  },
};
