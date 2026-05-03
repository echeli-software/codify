import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';

/**
 * Root of the student app: just the Ionic shell. Page-level chrome
 * (IonHeader / IonContent / tabs / sidebar) lives in each route component
 * so per-route layout choices stay local.
 */
@Component({
  imports: [IonApp, IonRouterOutlet],
  selector: 'app-root',
  template: `<ion-app><ion-router-outlet /></ion-app>`,
})
export class App {}
