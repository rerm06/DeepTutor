import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "./App";
import { createApiClient } from "./api/client";
import { I18nProvider } from "./i18n/I18nContext";
import { registerServiceWorker } from "./lib/pwa";
import { ROUTER_FUTURE } from "./lib/roles";
import { SessionProvider } from "./session/SessionContext";
import "./styles.css";

const api = createApiClient();
registerServiceWorker();
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <I18nProvider>
        <SessionProvider api={api}>
          <BrowserRouter future={ROUTER_FUTURE}>
            <AppRoutes />
          </BrowserRouter>
        </SessionProvider>
      </I18nProvider>
    </StrictMode>,
  );
}
