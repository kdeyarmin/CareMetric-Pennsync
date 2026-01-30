import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function UserPerformanceTable({ users }) {
  if (!users || users.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        No user performance data available
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs sm:text-sm whitespace-nowrap">Nurse</TableHead>
            <TableHead className="text-xs sm:text-sm whitespace-nowrap">Notes</TableHead>
            <TableHead className="text-xs sm:text-sm whitespace-nowrap hidden sm:table-cell">Avg Time</TableHead>
            <TableHead className="text-xs sm:text-sm whitespace-nowrap">Compliance</TableHead>
            <TableHead className="text-xs sm:text-sm whitespace-nowrap hidden md:table-cell">Quality</TableHead>
            <TableHead className="text-xs sm:text-sm whitespace-nowrap hidden lg:table-cell">AI Usage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user, index) => (
            <TableRow key={index}>
              <TableCell className="text-xs sm:text-sm font-medium max-w-[120px] sm:max-w-none truncate">
                {user.name}
              </TableCell>
              <TableCell className="text-xs sm:text-sm">{user.notesCount}</TableCell>
              <TableCell className="text-xs sm:text-sm hidden sm:table-cell">{user.avgDocTime}m</TableCell>
              <TableCell className="text-xs sm:text-sm">
                <Badge 
                  className={`text-xs ${
                    parseFloat(user.avgCompliance) >= 85 
                      ? 'bg-green-100 text-green-800' 
                      : parseFloat(user.avgCompliance) >= 70
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {user.avgCompliance}%
                </Badge>
              </TableCell>
              <TableCell className="text-xs sm:text-sm hidden md:table-cell">
                {user.avgQuality}%
              </TableCell>
              <TableCell className="text-xs sm:text-sm hidden lg:table-cell">
                {user.aiUtilization}%
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}