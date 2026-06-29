import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ArrowUpDown } from "lucide-react";

export default function UserPerformanceTable({ users }) {
  const [sortBy, setSortBy] = useState('notesCount');
  const [sortDirection, setSortDirection] = useState('desc');

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDirection('desc');
    }
  };

  const sortedUsers = [...users].sort((a, b) => {
    const aVal = parseFloat(a[sortBy]) || 0;
    const bVal = parseFloat(b[sortBy]) || 0;
    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const getComplianceBadge = (score) => {
    const val = parseFloat(score);
    if (val >= 85) return <Badge variant="success">Excellent</Badge>;
    if (val >= 70) return <Badge variant="warning">Good</Badge>;
    return <Badge variant="destructive">Needs Improvement</Badge>;
  };

  const sortButtonClass = "h-auto p-0 hover:bg-transparent text-xs font-semibold uppercase tracking-wide text-slate-500";

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>
            <Button variant="ghost" size="sm" onClick={() => handleSort('notesCount')} className={sortButtonClass}>
              Enhancements <ArrowUpDown className="w-3 h-3 ml-1 inline" />
            </Button>
          </TableHead>
          <TableHead>
            <Button variant="ghost" size="sm" onClick={() => handleSort('avgDocTime')} className={sortButtonClass}>
              Avg Time <ArrowUpDown className="w-3 h-3 ml-1 inline" />
            </Button>
          </TableHead>
          <TableHead>
            <Button variant="ghost" size="sm" onClick={() => handleSort('avgCompliance')} className={sortButtonClass}>
              Compliance <ArrowUpDown className="w-3 h-3 ml-1 inline" />
            </Button>
          </TableHead>
          <TableHead>
            <Button variant="ghost" size="sm" onClick={() => handleSort('avgQuality')} className={sortButtonClass}>
              Quality <ArrowUpDown className="w-3 h-3 ml-1 inline" />
            </Button>
          </TableHead>
          <TableHead>
            <Button variant="ghost" size="sm" onClick={() => handleSort('aiUtilization')} className={sortButtonClass}>
              AI Usage <ArrowUpDown className="w-3 h-3 ml-1 inline" />
            </Button>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedUsers.map((user) => (
          <TableRow key={user.email}>
            <TableCell>
              <p className="font-medium text-slate-900">{user.name}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
            </TableCell>
            <TableCell>{user.notesCount}</TableCell>
            <TableCell>{user.avgDocTime} min</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <span>{user.avgCompliance}%</span>
                {getComplianceBadge(user.avgCompliance)}
              </div>
            </TableCell>
            <TableCell>{user.avgQuality}%</TableCell>
            <TableCell>{user.aiUtilization}%</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
