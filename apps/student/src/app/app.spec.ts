import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideI18n } from '@codify/i18n';
import { provideAuth } from '@codify/auth';
import { AnalyticsClient, provideApiClient } from '@codify/api-client';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideIonicAngular(),
        provideAuth(),
        provideApiClient({ baseUrl: 'http://localhost:3000/api' }),
        provideI18n(),
        // No network in unit tests: telemetry batches go nowhere.
        {
          provide: AnalyticsClient,
          useValue: { send: jest.fn().mockResolvedValue({ accepted: 0 }) },
        },
      ],
    }).compileComponents();
  });

  it('mounts the Ionic shell', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('ion-app')).toBeTruthy();
    expect(compiled.querySelector('ion-router-outlet')).toBeTruthy();
    expect(compiled.querySelector('cdf-app-toast-host')).toBeTruthy();
  });
});
