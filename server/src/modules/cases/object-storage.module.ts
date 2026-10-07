import {Module} from '@nestjs/common';
import {AttachmentObjectService} from './attachment-object.service';
import {ObjectCompensationService} from './object-compensation.service';
import {MaskMapService} from './mask-map.service';
@Module({providers:[AttachmentObjectService,ObjectCompensationService,MaskMapService],exports:[AttachmentObjectService,ObjectCompensationService,MaskMapService]})
export class ObjectStorageModule{}
