import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  AppShell,
  Avatar,
  type NavSection,
  ToastHost,
} from '@codify/ui-bootstrap';

@Component({
  imports: [RouterModule, AppShell, Avatar, ToastHost],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly nav: NavSection[] = [
    {
      items: [
        { label: 'Playground', icon: 'gear', routerLink: ['/playground'] },
      ],
    },
    {
      label: 'Catalog',
      items: [
        { label: 'Courses', icon: 'pencil', routerLink: ['/courses'], badge: '5' },
        { label: 'Lesson editor', icon: 'pencil', routerLink: ['/lessons'] },
      ],
    },
  ];
}
