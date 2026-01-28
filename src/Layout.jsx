import React from "react";

export default function Layout({ children, currentPageName }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b p-4">
        <h1 className="text-xl font-bold">CareMetric AI - {currentPageName}</h1>
      </header>
      <main className="p-6">
        {children}
      </main>
    </div>
  );
}