export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const lastSegment = url.pathname.split("/").pop() ?? "";
    const isStaticAsset = lastSegment.includes(".");

    if (url.hostname === "portal.maiaenergiasrenovaveis.com.br" && !isStaticAsset && !url.pathname.startsWith("/portal")) {
      url.pathname = url.pathname === "/" ? "/portal" : "/portal" + url.pathname;
      return env.ASSETS.fetch(new Request(url, request));
    }

    return env.ASSETS.fetch(request);
  },
};
