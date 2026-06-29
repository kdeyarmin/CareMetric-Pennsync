import PDFSearchInterface from "../components/documents/PDFSearchInterface";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { Search } from "lucide-react";

export default function PDFSearch() {
  return (
    <PageContainer>
      <PageHeader
        icon={Search}
        eyebrow="Documentation"
        title="PDF Search"
        description="Search within all indexed PDF documents with fuzzy matching and advanced filters"
        favoritePage="PDFSearch"
      />
      <PDFSearchInterface />
    </PageContainer>
  );
}
