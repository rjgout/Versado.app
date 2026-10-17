import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.APP_URL?.trim() || "https://jehova.app";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/adminbackend/", "/api/", "/bookmarks/", "/study-folder/", "/change-password/",
        "/competition/", "/dashboard/", "/feedback/", "/forgot-password/",
        "/friends/", "/kids/", "/lesson/", "/live/", "/login/",
        "/onboarding/", "/profile/", "/register/", "/reset-password/",
        "/shop/", "/streak/", "/verify-email/", "/xp/",
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
