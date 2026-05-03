import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiBootstrap } from './ui-bootstrap';

describe('UiBootstrap', () => {
  let component: UiBootstrap;
  let fixture: ComponentFixture<UiBootstrap>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiBootstrap],
    }).compileComponents();

    fixture = TestBed.createComponent(UiBootstrap);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
