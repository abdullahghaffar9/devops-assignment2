'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';

interface NavbarProps {
  variant?: 'default' | 'hero';
}

interface AuthNavItem {
  label: string;
  href: string;
}

const Navbar: React.FC<NavbarProps> = ({ variant = 'default' }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const pathname = usePathname();

  const authNavItems: AuthNavItem[] = [
    { label: 'Schedule Consultation', href: '/meetings' },
  ];

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname?.startsWith(path);
  };

  // Handle scroll effect
  useEffect(() => {
    const checkScrollPosition = () => {
      const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
      setIsScrolled(scrollTop > 50);
    };

    // Check initial scroll position on mount
    checkScrollPosition();

    // Use passive listener for better performance
    window.addEventListener('scroll', checkScrollPosition, { passive: true });
    
    // Also listen for visibility changes to re-check scroll position when page becomes visible
    // This handles cases where the browser might optimize rendering when the tab is inactive
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkScrollPosition();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('scroll', checkScrollPosition);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Prevent body scroll when sidebar is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isMobileMenuOpen]);

  // Handle mobile viewport height for Safari
  useEffect(() => {
    const setVH = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    
    setVH();
    window.addEventListener('resize', setVH);
    window.addEventListener('orientationchange', setVH);
    
    return () => {
      window.removeEventListener('resize', setVH);
      window.removeEventListener('orientationchange', setVH);
    };
  }, []);

  // Different padding based on variant - consistent mobile padding
  const paddingClass = variant === 'hero'
    ? "py-4 sm:py-4"
    : "py-4 sm:py-5";

  return (
    <>
      <div
        className={`fixed top-0 left-0 right-0 z-[9999] w-full px-3 sm:px-4 lg:px-6 ${paddingClass}`}
        style={{
          background: isScrolled 
            ? 'linear-gradient(180deg, #0A0A0A 0%, rgba(10, 10, 10, 0.2) 80%, rgba(10, 10, 10, 0) 100%)'
            : 'transparent',
          backdropFilter: isScrolled ? 'blur(20px)' : 'none',
          WebkitBackdropFilter: isScrolled ? 'blur(20px)' : 'none',
          transition: 'background 300ms ease',
          // Explicitly prevent backdrop-filter from transitioning to avoid visual glitches
          // backdrop-filter should be instant to maintain blur effect when idle
        }}
      >
        {/* Mobile Layout - Toggle and Logo left, Button right */}
        <div className="lg:hidden max-w-7xl mx-auto flex flex-col">
          <div className="flex items-center justify-between">
          {/* Mobile Hamburger Menu & Logo - Left */}
          <div className="flex items-center gap-0">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="text-white hover:text-gray-300 focus:outline-none focus:text-gray-300 transition-colors active:outline-none cursor-pointer"
              aria-label="Toggle mobile menu"
              style={{ outline: 'none', WebkitTapHighlightColor: 'transparent' }}
            >
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {isMobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>

            {/* Logo - Next to toggle button */}
            <Link
              href="/"
              className="flex items-center gap-2 hover:opacity-80 transition-opacity outline-none focus:outline-none cursor-pointer"
              style={{ outline: 'none', WebkitTapHighlightColor: 'transparent' }}
            >
              <Image
                src="/logo/typography.png"
                alt="TechSol Logo"
                width={24}
                height={24}
                className="w-6 h-6 object-contain"
                style={{ filter: 'brightness(0) invert(1)' }}
                priority
              />
              <span className="text-lg sm:text-xl font-bold text-white">TechSol</span>
            </Link>
          </div>

          {/* CTA Button - Right */}
          <div className="flex items-center gap-2">
            <Link
              href="/admin/login"
              className="border border-white/60 text-white px-3 sm:px-3 py-2.5 sm:py-2 rounded-full text-xs sm:text-xs font-semibold hover:bg-white/10 transition-colors whitespace-nowrap h-10 sm:h-8 flex items-center cursor-pointer"
            >
              Admin
            </Link>
            <a
              href="/meetings"
              className="bg-white text-[#0A0A0A] px-4 sm:px-3 py-2.5 sm:py-2 rounded-full text-xs sm:text-xs font-semibold hover:bg-gray-100 transition-colors whitespace-nowrap h-10 sm:h-8 flex items-center cursor-pointer"
            >
              Schedule Consultation
            </a>
          </div>
          </div>

          
        </div>

        {/* Desktop Layout - Original */}
        <div className="hidden lg:flex max-w-7xl mx-auto items-center justify-between gap-8">
          {/* Logo with typography and TechSol */}
          <div className="flex items-center flex-shrink-0">
            <Link
                href="/"
                className="flex items-center gap-2 px-2 hover:opacity-80 transition-opacity outline-none focus:outline-none cursor-pointer"
                style={{ outline: 'none', WebkitTapHighlightColor: 'transparent' }}
            >
              <Image
                src="/logo/typography.png"
                alt="TechSol Logo"
                width={28}
                height={28}
                className="w-7 h-7 object-contain"
                style={{ filter: 'brightness(0) invert(1)' }}
                priority
              />
              <span className="text-xl font-bold text-white">TechSol</span>
            </Link>
          </div>

          <nav className="flex items-center justify-center flex-1 space-x-4 xl:space-x-6">
            {authNavItems.map((item) => (
              <Link
                  key={item.label}
                  href={item.href}
                  className={`text-xs sm:text-sm font-medium transition-colors focus:outline-none active:outline-none cursor-pointer ${
                    isActive(item.href) ? 'text-[#667EEA]' : 'text-white hover:text-gray-300'
                }`}
                style={{ outline: 'none', WebkitTapHighlightColor: 'transparent' }}
              >
                  {item.label}
              </Link>
            ))}
          </nav>

          {/* CTA Button */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <Link
              href="/admin/login"
              className="border border-white/60 text-white px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-white/10 transition-colors cursor-pointer"
            >
              Admin
            </Link>
            <a
              href="/meetings"
              className="bg-white text-[#0A0A0A] px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-gray-100 transition-colors cursor-pointer"
            >
              Schedule Consultation
            </a>
          </div>
        </div>
      </div>

      {/* Mobile Sidebar - Rendered outside navbar container */}
      {isMobileMenuOpen && (
        <>
          {/* Overlay with Backdrop Blur */}
          <div
            className="fixed inset-0 bg-black/60 lg:hidden"
            style={{
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              zIndex: 10000
            }}
            onClick={() => setIsMobileMenuOpen(false)}
          ></div>

          {/* Sidebar */}
          <div className="fixed top-0 left-0 w-[253px] bg-[#1F1F1F] lg:hidden flex flex-col shadow-2xl" style={{ 
            zIndex: 10001,
            height: 'calc(var(--vh, 1vh) * 100)',
            minHeight: '100vh'
          }}>
            {/* Logo Section */}
            <div className="px-6 pt-8 pb-6">
              <div className="flex items-center justify-between">
                <Link
                  href="/"
                  className="flex items-center gap-2 hover:opacity-80 transition-opacity outline-none focus:outline-none cursor-pointer"
                  style={{ outline: 'none', WebkitTapHighlightColor: 'transparent' }}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <Image
                    src="/logo/typography.png"
                    alt="TechSol Logo"
                    width={28}
                    height={28}
                    className="w-7 h-7 object-contain"
                    style={{ filter: 'brightness(0) invert(1)' }}
                    priority
                  />
                  <span className="text-xl font-bold text-white">TechSol</span>
                </Link>

              </div>
            </div>

            {/* Navigation Links */}
            <nav className="flex-1 px-4 py-6">
              <div className="flex flex-col gap-2">
                {authNavItems.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`flex items-center justify-start px-3 py-3 text-sm text-white rounded-lg transition-colors focus:outline-none active:outline-none cursor-pointer ${
                      isActive(item.href) ? 'bg-[#667EEA]' : 'hover:bg-gray-700'
                    }`}
                    style={{ outline: 'none', WebkitTapHighlightColor: 'transparent' }}
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                    }}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </nav>
          </div>
        </>
      )}
    </>
  );
};

export default Navbar;
