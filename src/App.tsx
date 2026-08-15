import { Routes, Route } from "react-router";
import Home from "./pages/Home";
import RequestsPage from "./pages/Requests";
import AnalyticsPage from "./pages/Analytics";
import EndpointsPage from "./pages/Endpoints";
import AlertsPage from "./pages/Alerts";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/requests" element={<RequestsPage />} />
      <Route path="/analytics" element={<AnalyticsPage />} />
      <Route path="/endpoints" element={<EndpointsPage />} />
      <Route path="/alerts" element={<AlertsPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
