import EmployeeTrainingSection from '@/components/training/EmployeeTrainingSection';
import EmployeeCertificateRow from '@/components/training/EmployeeCertificateRow';
import EmployeeTrainingPlanRow from '@/components/training/EmployeeTrainingPlanRow';
import EmployeeRequiredCourseRow from '@/components/training/EmployeeRequiredCourseRow';
export default function EmployeeTrainingDetails({ data }) {
  const employeeId = data.employee.id;
  return <div className="space-y-6">
    <EmployeeTrainingSection employeeId={employeeId} section="certificates" initialPage={data.certificates} title="Completed certifications" description="All issued training certificates, newest first. Expired and revoked awards remain visible as history; these are not professional licenses." empty="No training certificates have been issued for this employee." Row={EmployeeCertificateRow} />
    <EmployeeTrainingSection employeeId={employeeId} section="plans" initialPage={data.plans} title="Current training plans" description="Progress across active and overdue plans; completed and cancelled plans are excluded." empty="This employee has no current training plans." Row={EmployeeTrainingPlanRow} />
    <EmployeeTrainingSection employeeId={employeeId} section="courses" initialPage={data.courses} title="Upcoming required courses" description="Outstanding required assignments ordered by due date, including overdue courses that still need completion." empty="No outstanding required courses for this employee." Row={EmployeeRequiredCourseRow} />
  </div>;
}