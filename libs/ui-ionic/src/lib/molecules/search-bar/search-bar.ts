import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { IonSearchbar } from '@ionic/angular/standalone';
import { I18nService, TranslatePipe } from '@codify/i18n';
import { Icon } from '../../atoms/icon/icon.js';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  abort(): void;
  onresult:
    | ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

type SpeechCtor = new () => SpeechRecognitionLike;

function speechCtor(): SpeechCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Student search field: `<ion-searchbar>` with debounced `query` output,
 * clear button, and optional voice input (Web Speech API in the browser /
 * Capacitor WebView; the mic button only renders when supported).
 *
 *   <cdf-search-bar [(value)]="q" (query)="search($event)" [voice]="true" />
 */
@Component({
  selector: 'cdf-search-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonSearchbar, Icon, TranslatePipe],
  template: `
    <div class="cdf-search">
      <ion-searchbar
        class="cdf-search__bar"
        [value]="value()"
        [placeholder]="placeholder() ?? ('common.search' | translate)"
        [attr.aria-label]="
          ariaLabel() ?? placeholder() ?? ('common.search' | translate)
        "
        [debounce]="debounceMs()"
        showClearButton="focus"
        (ionInput)="onInput($any($event).detail.value)"
        (ionClear)="onInput('')"
      />
      @if (voice() && voiceSupported) {
        <button
          type="button"
          class="cdf-search__mic"
          [class.cdf-search__mic--on]="listening()"
          [attr.aria-pressed]="listening()"
          [attr.aria-label]="
            (listening() ? 'ui.search.voiceStop' : 'ui.search.voice')
              | translate
          "
          (click)="toggleVoice()"
        >
          <cdf-icon name="mic" size="md" />
        </button>
      }
    </div>
  `,
  styleUrl: './search-bar.scss',
})
export class SearchBar {
  private readonly i18n = inject(I18nService);

  readonly value = model('');
  readonly placeholder = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly debounceMs = input(300);
  /** Offer voice input when the platform supports it. */
  readonly voice = input(false);

  /** Debounced query (ion-searchbar handles the debounce). */
  readonly query = output<string>();

  protected readonly voiceSupported = speechCtor() !== null;
  protected readonly listening = signal(false);
  private recognition: SpeechRecognitionLike | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.recognition?.abort());
  }

  protected onInput(v: string | null | undefined): void {
    const text = v ?? '';
    this.value.set(text);
    this.query.emit(text);
  }

  protected toggleVoice(): void {
    if (this.listening()) {
      this.recognition?.abort();
      this.listening.set(false);
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = this.i18n.currentLocale();
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (ev) => {
      const transcript = ev.results[0]?.[0]?.transcript ?? '';
      if (transcript) this.onInput(transcript);
    };
    rec.onend = () => this.listening.set(false);
    rec.onerror = () => this.listening.set(false);
    this.recognition = rec;
    this.listening.set(true);
    rec.start();
  }
}
