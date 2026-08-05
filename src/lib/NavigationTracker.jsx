import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useAuth } from './AuthContext';
import { base44 } from '@/api/base44Client';
import { PAGE_NAMES, MAIN_PAGE } from '@/routes';

export default function NavigationTracker() {
    const location = useLocation();
    const { isAuthenticated } = useAuth();
    const mainPageKey = MAIN_PAGE ?? PAGE_NAMES[0];

    // Post navigation changes to the embedding window (the Base44 preview host)
    // so it can follow which page is open.
    //
    // The full href is NOT sent: it carries PHI and capability tokens in its
    // query string (?id=<patient id>, ?token=<signer token>, signed-PDF URLs),
    // and this goes out with targetOrigin '*' — readable by ANY page that frames
    // the app, hostile or not. The pathname alone identifies the page, which is
    // all "app_changed_url" is for. Only posted when actually embedded; when the
    // app is top-level, window.parent is window and this just messaged itself.
    useEffect(() => {
        if (typeof window === 'undefined' || window.parent === window) return;
        window.parent.postMessage({
            type: "app_changed_url",
            url: `${window.location.origin}${window.location.pathname}`
        }, '*');
    }, [location]);

    // Log user activity when navigating to a page
    useEffect(() => {
        // Extract page name from pathname
        const pathname = location.pathname;
        let pageName;
        
        if (pathname === '/' || pathname === '') {
            pageName = mainPageKey;
        } else {
            // Remove leading slash and get the first segment
            const pathSegment = pathname.replace(/^\//, '').split('/')[0];

            // Try case-insensitive lookup against the known route names
            const matchedKey = PAGE_NAMES.find(
                key => key.toLowerCase() === pathSegment.toLowerCase()
            );

            pageName = matchedKey || null;
        }

        if (isAuthenticated && pageName) {
            base44.appLogs.logUserInApp(pageName).catch(() => {
                // Silently fail - logging shouldn't break the app
            });
        }
    }, [location, isAuthenticated, mainPageKey]);

    return null;
}