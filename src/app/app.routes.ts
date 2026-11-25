import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'tabs',
    loadComponent: () => import('./ui/tabs/tabs.page').then((m) => m.TabsPage),
    children: [
      {
        path: 'inicio',
        loadComponent: () => import('./ui/inicio/inicio.page').then((m) => m.InicioPage),
      },
      {
        path: 'movimientos',
        loadComponent: () =>
          import('./ui/movimientos/movimientos.page').then((m) => m.MovimientosPage),
      },
      {
        path: 'fijos',
        loadComponent: () => import('./ui/fijos/fijos.page').then((m) => m.FijosPage),
      },
      {
        path: 'dinero',
        loadComponent: () => import('./ui/dinero/dinero.page').then((m) => m.DineroPage),
      },
      // Direcciones viejas: llevan a la sección correspondiente de Dinero.
      {
        path: 'planes',
        loadComponent: () => import('./ui/planes/planes.page').then((m) => m.PlanesPage),
      },
      { path: 'ahorro', redirectTo: '/tabs/planes?ver=metas' },
      { path: '', redirectTo: 'inicio', pathMatch: 'full' },
    ],
  },
  {
    path: 'calculadoras',
    loadComponent: () => import('./ui/calculadoras/calculadoras.page').then((m) => m.CalculadorasPage),
  },
  {
    path: 'calendario',
    loadComponent: () => import('./ui/calendario/calendario.page').then((m) => m.CalendarioPage),
  },
  {
    path: 'ajustes/reglas',
    loadComponent: () => import('./ui/ajustes/reglas.page').then((m) => m.ReglasPage),
  },
  {
    path: 'ajustes/categorias',
    loadComponent: () => import('./ui/ajustes/categorias.page').then((m) => m.CategoriasPage),
  },
  {
    path: 'ajustes',
    loadComponent: () => import('./ui/ajustes/ajustes.page').then((m) => m.AjustesPage),
  },
  {
    path: 'ajustes/importar',
    loadComponent: () => import('./ui/ajustes/importar.page').then((m) => m.ImportarPage),
  },
  {
    path: 'ajustes/:seccion',
    loadComponent: () => import('./ui/ajustes/ajustes.page').then((m) => m.AjustesPage),
  },
  {
    path: 'reportes',
    loadComponent: () => import('./ui/reportes/reportes.page').then((m) => m.ReportesPage),
  },
  {
    path: 'bienvenida',
    loadComponent: () => import('./ui/bienvenida/bienvenida.page').then((m) => m.BienvenidaPage),
  },
  { path: 'cuentas', redirectTo: '/tabs/dinero?ver=cuentas' },
  { path: 'deudas', redirectTo: '/tabs/planes?ver=deudas' },
  { path: '', redirectTo: 'tabs', pathMatch: 'full' },
];
