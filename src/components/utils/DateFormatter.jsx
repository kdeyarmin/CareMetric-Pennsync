import { formatEastern, formatRelativeEastern, todayEastern } from "@/components/utils/timezone";

/**
 * Centralized date formatting utility
 * Always uses America/New_York timezone for consistency
 */

export const formatDate = (date, format = 'PPP') => {
  if (!date) return '';
  return formatEastern(date, format);
};

export const formatDateTime = (date) => {
  if (!date) return '';
  return formatEastern(date, 'PPP p');
};

export const formatTime = (date) => {
  if (!date) return '';
  return formatEastern(date, 'p');
};

export const formatRelative = (date) => {
  if (!date) return '';
  return formatRelativeEastern(date);
};

export const getCurrentDate = () => {
  return todayEastern();
};

export const formatShortDate = (date) => {
  if (!date) return '';
  return formatEastern(date, 'MM/dd/yyyy');
};

export const formatLongDate = (date) => {
  if (!date) return '';
  return formatEastern(date, 'EEEE, MMMM d, yyyy');
};