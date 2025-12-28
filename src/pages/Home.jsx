import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export const publicPage = true;

export default function Home() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate(createPageUrl("Homepage"), { replace: true });
  }, [navigate]);

  return null;
}