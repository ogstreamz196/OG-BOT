<?xml version="1.0" encoding="UTF-8"?>
<!-- Makes sitemaps readable when a person opens one in a browser. Search engines ignore this. -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html lang="en-GB">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="robots" content="noindex"/>
        <title>OG B0T sitemap</title>
        <style>
          body{margin:0;padding:24px 16px;background:#0a0a0a;color:#f5f5f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
          main{max-width:760px;margin:0 auto}
          h1{font-size:22px;margin:0 0 4px}
          p{color:#a3a3a3;margin:0 0 20px;font-size:14px}
          ol{padding-left:22px;margin:0}
          li{padding:8px 0;border-bottom:1px solid #262626;font-size:14px;word-break:break-all}
          a{color:#8ab4ff;text-decoration:none}
          span{color:#737373;font-size:12px;margin-left:8px}
        </style>
      </head>
      <body>
        <main>
          <h1>OG B0T sitemap</h1>
          <p>This list is for search engines. <xsl:value-of select="count(s:urlset/s:url)"/> pages. <a href="/welcome">Go to OG B0T</a></p>
          <ol>
            <xsl:for-each select="s:urlset/s:url">
              <li>
                <a href="{s:loc}"><xsl:value-of select="s:loc"/></a>
                <xsl:if test="s:lastmod"><span><xsl:value-of select="s:lastmod"/></span></xsl:if>
              </li>
            </xsl:for-each>
          </ol>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
