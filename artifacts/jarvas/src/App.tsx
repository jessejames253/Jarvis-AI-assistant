/**
 * App.tsx — Root component for the Jarvis web app
 *
 * This file sets up the global "wiring" that wraps every page in the app:
 *
 *  - QueryClientProvider  Gives every component access to server data fetching
 *                         (via TanStack Query). Think of it as a global cache
 *                         for API responses.
 *
 *  - TooltipProvider      Makes tooltips (hover hints) available app-wide.
 *
 *  - WouterRouter         Handles URL-based navigation. When the URL is "/",
 *                         it shows the Chat page. When no URL matches, it shows
 *                         the NotFound page. (Wouter is a lightweight alternative
 *                         to React Router.)
 *
 *  - Toaster              A floating notification system for showing quick
 *                         success/error messages anywhere in the app.
 *
 * To add a new page, create a file in src/pages/ and add a <Route> below.
 */

import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Chat from "@/pages/Chat";
import Dashboard from "@/pages/Dashboard";
import KnowledgeBase from "@/pages/KnowledgeBase";
import NotFound from "@/pages/not-found";

// QueryClient is the central cache for all API data fetching in the app.
// Created once here at the top level so it persists for the entire session.
const queryClient = new QueryClient();

// Router maps URL paths to page components.
// "/"           → Chat page (the main interface)
// "/dashboard"  → Task management dashboard
// "/kb"         → Knowledge Base (notes, research, facts)
// anything else → NotFound page (404)
function Router() {
  return (
    <Switch>
      <Route path="/" component={Chat} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/kb" component={KnowledgeBase} />
      <Route component={NotFound} />
    </Switch>
  );
}

// App is the root of the component tree.
// Every page and component in the app is a child of this.
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {/* BASE_URL is set by Vite — it's "/" in dev and the deployment path in production */}
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
