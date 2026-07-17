import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard,
  Users,
  GitBranch,
  LogOut,
  Menu,
  X,
  User,
  UserCog,
  ShieldAlert,
  MapPin,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { path: '/', label: 'Tableau de bord', icon: LayoutDashboard, adminOnly: false },
  { path: '/prospects', label: 'Prospects', icon: Users, adminOnly: false },
  { path: '/pipeline', label: 'Pipeline', icon: GitBranch, adminOnly: false },
  { path: '/attributions', label: 'Attributions', icon: MapPin, adminOnly: false },
  { path: '/admin/users', label: 'Gestion utilisateurs', icon: UserCog, adminOnly: true },
];

export default function Layout({ children }: LayoutProps) {
  const { user, userRole, logout, login, loading, isAdmin, accessDenied } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-teal-50">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <img src="/assets/lyftt-logo.png" alt="LYFTT" className="w-16 h-16 rounded-2xl animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#6AABB4] animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 rounded-full bg-[#6AABB4] animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 rounded-full bg-[#6AABB4] animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a3a4a] via-[#1e4a5a] to-[#2a5a6a] relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-[#6AABB4]/15 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[#5A9BA3]/15 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#6AABB4]/5 rounded-full blur-3xl" />
        </div>
        <div className="relative bg-white/95 glass rounded-3xl shadow-2xl p-10 max-w-md w-full text-center space-y-6 animate-scale-in mx-4">
          <img src="https://mgx-backend-cdn.metadl.com/generate/images/1020992/2026-04-13/3c2b958e-d0a4-4fa0-93e0-46e55475cd08.png" alt="LYFTT" className="w-20 h-20 rounded-2xl mx-auto shadow-lg shadow-[#6AABB4]/25" />
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">LYFTT CRM</h1>
            <p className="text-slate-500 mt-2">
              Plateforme de suivi commercial
            </p>
          </div>
          <Button
            onClick={login}
            className="w-full bg-gradient-to-r from-[#5A9BA3] to-[#6AABB4] hover:from-[#4A8B93] hover:to-[#5A9BA4] text-white py-3 text-lg rounded-xl shadow-lg shadow-[#6AABB4]/25 transition-all duration-300 hover:shadow-xl hover:shadow-[#6AABB4]/30 hover:-translate-y-0.5"
          >
            Se connecter
          </Button>
        </div>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-red-950 to-rose-900 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-red-500/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-rose-500/10 rounded-full blur-3xl" />
        </div>
        <div className="relative bg-white/95 glass rounded-3xl shadow-2xl p-10 max-w-md w-full text-center space-y-6 animate-scale-in mx-4">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto">
            <ShieldAlert className="w-8 h-8 text-red-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Accès non autorisé</h1>
            <p className="text-slate-500 mt-2">
              Votre compte n&apos;a pas encore été activé par un administrateur.
              Veuillez contacter votre responsable.
            </p>
          </div>
          <Button
            onClick={logout}
            variant="outline"
            className="w-full py-3 rounded-xl"
          >
            Se déconnecter
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-teal-50/30 flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 glass z-40 lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-[260px] bg-gradient-to-b from-[#1a3a4a] via-[#1e4a5a] to-[#1a3a4a] text-white transform transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <img src="https://mgx-backend-cdn.metadl.com/generate/images/1020992/2026-04-13/cd3e5413-7995-4bb0-95fb-38792f5cde9c.png" alt="LYFTT" className="w-10 h-10 rounded-xl shadow-lg shadow-[#6AABB4]/20" />
            <div>
              <span className="text-lg font-bold tracking-tight">LYFTT</span>
              <span className="text-xs text-[#6AABB4]/70 block -mt-0.5">CRM Platform</span>
            </div>
          </div>
          <button
            className="lg:hidden text-slate-400 hover:text-white transition-colors"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-1 flex-1 mt-2">
          {navItems.filter((item) => !item.adminOnly || isAdmin).map((item) => {
            const isActive =
              item.path === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 group ${
                  isActive
                    ? 'bg-gradient-to-r from-[#5A9BA3]/90 to-[#6AABB4]/90 text-white shadow-lg shadow-[#6AABB4]/20'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <item.icon className={`w-[18px] h-[18px] transition-transform duration-200 ${
                  isActive ? '' : 'group-hover:scale-110'
                }`} />
                <span className="font-medium text-sm">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="p-3 border-t border-white/10 mt-auto">
          <div className="flex items-center gap-3 px-3 py-2.5 mb-1 rounded-xl bg-white/5">
            <div className="w-9 h-9 bg-gradient-to-br from-[#5A9BA3] to-[#6AABB4] rounded-lg flex items-center justify-center ring-2 ring-white/10">
              <User className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {userRole?.first_name
                  ? `${userRole.first_name} ${userRole.last_name || ''}`
                  : user.name || 'Commercial'}
              </p>
              {isAdmin && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-500/20 text-amber-300 border-0 mt-0.5">
                  Admin
                </Badge>
              )}
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-3 px-4 py-2.5 w-full text-slate-500 hover:text-red-400 transition-all duration-200 rounded-xl hover:bg-red-500/5"
          >
            <LogOut className="w-4 h-4" />
            <span className="text-sm font-medium">Déconnexion</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="bg-white/80 glass border-b border-slate-200/60 px-5 py-3.5 flex items-center gap-4 lg:hidden sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-slate-600 hover:text-slate-900 transition-colors p-1"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <img src="https://mgx-backend-cdn.metadl.com/generate/images/1020992/2026-04-13/73359514-17f3-4757-a994-7581e4f71021.png" alt="LYFTT" className="w-7 h-7 rounded-lg" />
            <h1 className="text-base font-bold text-slate-900">LYFTT CRM</h1>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto smooth-scroll">
          <div className="animate-page-enter">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}