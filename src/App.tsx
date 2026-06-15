import { Navigate, Route, Routes } from "react-router-dom";
import SessionsList from "./pages/SessionsList";
import LiveCount from "./pages/LiveCount";
import SessionSummary from "./pages/SessionSummary";

export default function App() {
  return (
    <div className="min-h-full">
      <Routes>
        <Route path="/" element={<SessionsList />} />
        <Route path="/count/:sessionId" element={<LiveCount />} />
        <Route path="/summary/:sessionId" element={<SessionSummary />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
