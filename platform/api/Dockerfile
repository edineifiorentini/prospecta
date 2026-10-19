# API e worker da Prospecta (mesma imagem). Base Playwright: inclui Node 24 e Chromium
# para a renderização de páginas JS (Crawlee/Playwright), Lighthouse e geração de PDF.
FROM mcr.microsoft.com/playwright:v1.64.1-noble AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 NEXT_TELEMETRY_DISABLED=1
COPY api/package.json api/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY api/tsconfig.json api/tsconfig.build.json api/prisma.config.ts ./
COPY api/prisma ./prisma
COPY api/src ./src
RUN npx prisma generate && npx tsc -p tsconfig.build.json && npm prune --omit=dev --no-audit --no-fund

FROM mcr.microsoft.com/playwright:v1.64.1-noble AS runtime
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 NPM_CONFIG_UPDATE_NOTIFIER=false
COPY --from=build --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /app/dist ./dist
COPY --from=build --chown=pwuser:pwuser /app/prisma ./prisma
COPY --from=build --chown=pwuser:pwuser /app/prisma.config.ts /app/package.json ./
COPY api/docker-entrypoint.sh /usr/local/bin/prospecta-entrypoint
RUN chmod +x /usr/local/bin/prospecta-entrypoint
USER pwuser
EXPOSE 4000
ENTRYPOINT ["prospecta-entrypoint"]
CMD ["node", "dist/server.js"]
